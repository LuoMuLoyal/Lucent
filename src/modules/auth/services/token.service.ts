import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { User } from '#generated/prisma/client.js';
import { ConfigKey } from '../../../config/env/config-keys.enum.js';
import { EnvKey } from '../../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../config/runtime/runtime-config.types.js';

import { now } from '../../../common/index.js';
import {
  createDomainFailure,
  DomainFailureException,
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
  mapUnknownToInternalFailure,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import { PrismaService } from '../../../prisma/index.js';
import type {
  AuthRequestContext,
  TokenPair,
  UserPayload,
} from '../types/auth-request.js';
import {
  AuthSessionRepositoryPort,
  type SessionContextData,
  type SessionWithUser,
} from '../repositories/session.repository.js';

export type {
  AuthRequestContext,
  TokenPair,
  UserPayload,
} from '../types/auth-request.js';

/**
 * How long after a rotation a replayed refresh token is assumed to be a
 * concurrent request from the same client rather than theft.
 *
 * Keep this small: it delays (but does not prevent) reuse detection for tokens
 * stolen in the same instant as the legitimate rotation.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

interface JwtConfigShape {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: number;
  refreshTtl: number;
  issuer: string;
  audience: string;
}

@Injectable()
export class AuthTokenService {
  private readonly logger = new Logger(AuthTokenService.name);

  constructor(
    private readonly sessionRepository: AuthSessionRepositoryPort,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {}

  /**
   * Signing config with the TTLs overlaid from the runtime snapshot.
   *
   * Resolved per call: a published TTL applies to tokens issued afterwards.
   * Tokens already signed keep the expiry baked into their `exp`; secrets stay
   * environment-only.
   */
  private get jwtConfig(): JwtConfigShape {
    const base = this.configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);
    const values = this.runtimeConfig?.getSnapshot().values;
    return {
      ...base,
      accessTtl: values?.[EnvKey.JWT_ACCESS_TTL] ?? base.accessTtl,
      refreshTtl: values?.[EnvKey.JWT_REFRESH_TTL] ?? base.refreshTtl,
    };
  }

  /**
   * Issues a token pair and the session record that backs it.
   *
   * @param user the authenticated user.
   * @param context request metadata recorded on the session row.
   * @param familyId token family to join. Omit on a fresh login: the new session
   *   becomes its own family root (its id **is** the family id). Rotations pass
   *   the family of the session they replace, which is what makes reuse
   *   detection able to revoke the whole chain.
   */
  generateTokenPair(
    user: User,
    context?: AuthRequestContext,
    familyId?: string,
  ): ResultAsync<TokenPair, DomainFailure> {
    const config = this.jwtConfig;
    const payload: UserPayload = {
      sub: user.id,
      email: user.email,
      status: user.status,
    };

    const accessTokenId = randomBytes(16).toString('hex');
    const refreshToken = randomBytes(32).toString('hex');
    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    const now = Date.now();
    const accessTokenExpiresInMs = config.accessTtl * 1000;
    const refreshTokenExpiresInMs = config.refreshTtl * 1000;

    // Create the session record BEFORE signing the JWT. If signAsync fails
    // after the session is created, the refreshToken is never returned to the
    // caller so the orphaned session is harmless and will expire via TTL.
    // The previous order (sign JWT first, then create session) could leave the
    // user with a valid accessToken but no session record, making refresh
    // impossible and forcing a full re-login.
    const sessionId = randomUUID();
    const sessionInput: Parameters<
      AuthSessionRepositoryPort['createSession']
    >[0] = {
      id: sessionId,
      userId: user.id,
      refreshTokenHash,
      expiresAt: new Date(now + refreshTokenExpiresInMs),
      lastUsedAt: new Date(now),
      familyId: familyId ?? sessionId,
    };
    const contextData = this.getSessionContextData(context);
    if (contextData != null) {
      sessionInput.context = contextData;
    }

    return fromPromise(
      this.sessionRepository.createSession(sessionInput),
      (error) => mapUnknownToInternalFailure(error, 'Failed to create session'),
    )
      .andThen(() =>
        fromPromise(
          this.jwtService.signAsync(payload, {
            secret: config.accessSecret,
            expiresIn: config.accessTtl,
            algorithm: 'HS512',
            jwtid: accessTokenId,
            issuer: config.issuer,
            audience: config.audience,
          }),
          (error) => {
            this.logger.error(
              `JWT signing failed for user ${user.id} after session creation: ${error instanceof Error ? error.message : String(error)}`,
              error instanceof Error ? error.stack : undefined,
            );
            return mapUnknownToInternalFailure(
              error,
              'Token signing failed after session creation',
            );
          },
        ),
      )
      .map((accessToken) => ({
        accessToken,
        refreshToken,
        accessTokenExpiresAt: new Date(
          now + accessTokenExpiresInMs,
        ).toISOString(),
        refreshTokenExpiresAt: new Date(
          now + refreshTokenExpiresInMs,
        ).toISOString(),
      }));
  }

  /**
   * Rotates a refresh token and returns **whose** session it was.
   *
   * The cookie-session adapter needs the user to build the response body after
   * rotation. Returning it from here is exact: the session record already holds
   * the user, so no second lookup and no JWT decoding is required.
   * `refresh()` below stays as the token-only view for the Bearer callers.
   */
  refreshWithUser(
    refreshToken: string,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User; tokens: TokenPair }, DomainFailure> {
    return this.rotateSession(refreshToken, context);
  }

  refresh(
    refreshToken: string,
    context?: AuthRequestContext,
  ): ResultAsync<TokenPair, DomainFailure> {
    return this.rotateSession(refreshToken, context).map(
      (rotated) => rotated.tokens,
    );
  }

  private rotateSession(
    refreshToken: string,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User; tokens: TokenPair }, DomainFailure> {
    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    return this.sessionRepository
      .findSessionByRefreshTokenHash(refreshTokenHash)
      .orElse((error) => {
        // Session not found — the token never existed, expired, or its row was
        // removed by the retention job. Log for observability (digest only,
        // never the raw token) and propagate the failure unchanged; other
        // failures are untouched.
        if (error.code === 'AUTH_REFRESH_TOKEN_INVALID') {
          this.logRefreshTokenInvalid(refreshTokenHash, 'not-found');
        }
        return errAsync(error);
      })
      .andThen((record) => {
        if (record.expiresAt < now() || record.revokedAt !== null) {
          this.logRefreshTokenInvalid(
            refreshTokenHash,
            record.revokedAt !== null ? 'revoked' : 'expired',
            record.userId,
          );
          return errAsync(this.refreshTokenInvalidFailure());
        }

        // Already rotated: this exact refresh token was exchanged before.
        // Either two callers raced (benign) or someone is replaying a stolen
        // token (theft). `classifyReuse` decides, and in the theft case it
        // revokes the whole family.
        if (record.rotatedAt !== null) {
          return this.classifyReuse(record, refreshTokenHash);
        }

        // Atomically claim the row by stamping `rotatedAt`. Only one caller can
        // win; the losers re-read the row and go through the same reuse
        // classification (they lost a race, or they are replaying).
        return this.sessionRepository
          .claimSessionForRefresh(record.id)
          .orElse((error) => {
            if (error.code !== 'AUTH_REFRESH_TOKEN_INVALID') {
              return errAsync(error);
            }

            return (
              this.sessionRepository
                .findSessionById(record.id)
                // The row can disappear between the claim attempt and this read
                // (retention job, concurrent family revocation). For a refresh
                // caller that is simply "this token is no longer usable" — never
                // leak the internal AUTH_SESSION_NOT_FOUND code here.
                .orElse((readError) => {
                  this.logger.warn(
                    'Session vanished while resolving a lost refresh claim',
                    {
                      code: 'AUTH_REFRESH_TOKEN_INVALID',
                      reason: 'vanished-during-claim',
                      userId: record.userId,
                      readErrorCode: readError.code,
                    },
                  );
                  return errAsync(this.refreshTokenInvalidFailure());
                })
                .andThen((claimed) =>
                  claimed.rotatedAt === null
                    ? errAsync(this.refreshTokenInvalidFailure())
                    : this.classifyReuse(
                        {
                          ...record,
                          rotatedAt: claimed.rotatedAt,
                          revokedAt: claimed.revokedAt,
                        },
                        refreshTokenHash,
                      ),
                )
            );
          })
          .andThen(() =>
            // The rotation joins the same family so a later replay of any token
            // in this chain can still revoke every descendant.
            this.generateTokenPair(record.user, context, record.familyId).map(
              (tokens) => ({
                user: record.user,
                tokens,
              }),
            ),
          );
      });
  }

  /**
   * Decides what an already-rotated refresh token means.
   *
   * ## Two very different situations look identical
   *
   * - **Benign race**: the same client fired two refreshes at once (two tabs,
   *   or a client without single-flight). The loser must simply fail, and the
   *   winner's session must survive.
   * - **Replay**: a stolen token is being used after the legitimate client
   *   already rotated it. RFC 9700 §4.13.2 says this must be treated as a
   *   compromise and the whole token family revoked.
   *
   * The only signal available is **how long ago** the rotation happened, hence
   * {@link REFRESH_REUSE_GRACE_MS}. Inside the window we assume a race and only
   * fail the request; outside it we assume theft and revoke the family.
   *
   * ## Why a grace window is a deliberate trade
   *
   * Without it, two tabs refreshing simultaneously would revoke each other's
   * session and log the user out — a self-inflicted outage. Without the window's
   * **upper bound**, a replayed token would never be flagged. The window is
   * therefore kept short and is the same trade Auth0 documents as "reuse
   * interval".
   */
  private classifyReuse(
    record: SessionWithUser,
    refreshTokenHash: string,
  ): ResultAsync<never, DomainFailure> {
    const rotatedAgoMs =
      record.rotatedAt === null
        ? 0
        : now().getTime() - record.rotatedAt.getTime();

    if (record.rotatedAt !== null && rotatedAgoMs <= REFRESH_REUSE_GRACE_MS) {
      this.logger.warn('Refresh token replayed inside the concurrency grace', {
        code: 'AUTH_REFRESH_TOKEN_INVALID',
        reason: 'concurrent-refresh',
        userId: record.userId,
        familyId: record.familyId,
        rotatedAgoMs,
        refreshTokenHash: `${refreshTokenHash.slice(0, 12)}…`,
      });
      return errAsync(this.refreshTokenInvalidFailure());
    }

    // Replay outside the grace window: treat as theft. Revoking the family kills
    // both the legitimate chain and anything the thief obtained from it.
    return this.sessionRepository
      .revokeSessionFamily(record.userId, record.familyId)
      .map((revoked) => {
        this.logger.error(
          'Refresh token reuse detected, session family revoked',
          {
            code: 'AUTH_REFRESH_TOKEN_INVALID',
            reason: 'reuse-detected',
            userId: record.userId,
            familyId: record.familyId,
            revokedSessions: revoked,
            rotatedAgoMs,
            refreshTokenHash: `${refreshTokenHash.slice(0, 12)}…`,
          },
        );
      })
      .andThen(() => errAsync(this.refreshTokenInvalidFailure()));
  }

  revoke(
    userId: string,
    refreshToken: string,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(
      this.prisma.$transaction(async (tx) => {
        // Throw-to-short-circuit inside a Prisma transaction callback: the
        // throw triggers a rollback and is caught by the fromPromise mapper
        // below, which unwraps DomainFailureException back to its original
        // DomainFailure (preserving the precise error code). This is the
        // standard pattern for Result-based code inside transaction callbacks
        // that cannot return ResultAsync themselves.
        const lucentResult =
          await this.sessionRepository.deleteSessionsByUserIdAndHash(
            userId,
            this.hashRefreshToken(refreshToken),
            tx,
          );

        if (lucentResult.isErr()) {
          throw new DomainFailureException(lucentResult.error);
        }
      }),
      (error) => {
        if (error instanceof DomainFailureException) {
          return error.failure;
        }
        return mapUnknownToDependencyFailure(
          error,
          'Session revocation failed',
        );
      },
    ).map(() => undefined);
  }

  revokeAll(userId: string): ResultAsync<void, DomainFailure> {
    return fromPromise(
      this.prisma.$transaction(async (tx) => {
        // Same throw-to-short-circuit pattern as revoke() — see the
        // comment there for the rationale.
        const lucentResult =
          await this.sessionRepository.deleteSessionsByUserId(userId, tx);

        if (lucentResult.isErr()) {
          throw new DomainFailureException(lucentResult.error);
        }
      }),
      (error) => {
        if (error instanceof DomainFailureException) {
          return error.failure;
        }
        return mapUnknownToDependencyFailure(
          error,
          'Session revocation failed',
        );
      },
    ).map(() => undefined);
  }

  revokeById(
    userId: string,
    sessionId: string,
  ): ResultAsync<void, DomainFailure> {
    return this.sessionRepository
      .findSessionById(sessionId)
      .andThen((record) => {
        if (record.userId !== userId) {
          return errAsync(
            createDomainFailure({
              kind: 'authorization',
              code: 'AUTH_SESSION_ACCESS_DENIED',
            }),
          );
        }
        return this.sessionRepository.revokeSessionById(sessionId);
      });
  }

  listSessions(userId: string): ResultAsync<
    Array<{
      id: string;
      deviceType: string | null;
      deviceName: string | null;
      platform: string | null;
      lastUsedAt: string | null;
      createdAt: string;
      expiresAt: string;
      isCurrent: boolean;
    }>,
    DomainFailure
  > {
    return this.sessionRepository.listActiveSessions(userId).map((records) =>
      records.map((record) => ({
        id: record.id,
        deviceType: record.deviceType,
        deviceName: record.deviceName,
        platform: record.platform,
        lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        isCurrent: false,
      })),
    );
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshTokenInvalidFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'authentication',
      code: 'AUTH_REFRESH_TOKEN_INVALID',
    });
  }

  /**
   * Structured warn for an invalid, expired, revoked or already-claimed
   * (or expired before claim) refresh token. Never logs the raw token —
   * only a short digest of its hash
   * plus the user id when known, for correlating logs with session records.
   */
  private logRefreshTokenInvalid(
    refreshTokenHash: string,
    reason: 'not-found' | 'expired' | 'revoked' | 'already-claimed-or-expired',
    userId?: string,
  ): void {
    this.logger.warn('Refresh token invalid', {
      code: 'AUTH_REFRESH_TOKEN_INVALID',
      reason,
      ...(userId !== undefined && { userId }),
      refreshTokenHash: `${refreshTokenHash.slice(0, 12)}…`,
    });
  }

  private getSessionContextData(
    context: AuthRequestContext | undefined,
  ): SessionContextData | undefined {
    if (context == null) return undefined;
    return {
      ...(context.ipAddress !== undefined && { ipAddress: context.ipAddress }),
      ...(context.userAgent !== undefined && { userAgent: context.userAgent }),
    };
  }
}
