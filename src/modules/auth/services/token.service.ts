import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { User } from '#generated/prisma/client';
import { ConfigKey } from '../../../config/env/config-keys.enum';

import { now } from '../../../common';
import {
  createDomainFailure,
  DomainFailureException,
  errAsync,
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';
import { PrismaService } from '../../../prisma';
import type {
  AuthRequestContext,
  TokenPair,
  UserPayload,
} from '../types/auth-request';
import {
  AuthSessionRepositoryPort,
  type SessionContextData,
} from '../repositories/session.repository';
import { AuthBetterAuthAdapter } from '../adapters/better-auth.adapter.js';

export type {
  AuthRequestContext,
  TokenPair,
  UserPayload,
} from '../types/auth-request';

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
    private readonly betterAuthAdapter: AuthBetterAuthAdapter,
    private readonly prisma: PrismaService,
  ) {}

  private get jwtConfig(): JwtConfigShape {
    return this.configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);
  }

  generateTokenPair(
    user: User,
    context?: AuthRequestContext,
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
    const sessionInput: Parameters<
      AuthSessionRepositoryPort['createSession']
    >[0] = {
      userId: user.id,
      refreshTokenHash,
      expiresAt: new Date(now + refreshTokenExpiresInMs),
      lastUsedAt: new Date(now),
    };
    const contextData = this.getSessionContextData(context);
    if (contextData != null) {
      sessionInput.context = contextData;
    }

    return fromPromise(
      this.sessionRepository.createSession(sessionInput),
      (error) => {
        throw error;
      },
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
            throw new InternalServerErrorException({
              code: 'INTERNAL_ERROR',
              message:
                'Token signing failed after session creation; please re-authenticate.',
            });
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

  refresh(
    refreshToken: string,
    context?: AuthRequestContext,
  ): ResultAsync<TokenPair, DomainFailure> {
    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    return this.sessionRepository
      .findSessionByRefreshTokenHash(refreshTokenHash)
      .orElse((error) => {
        // Session not found — the token never existed or was already removed.
        // Log for observability (digest only, never the raw token) and
        // propagate the failure unchanged; other failures are untouched.
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

        // Atomically claim the session by deleting it before generating new
        // tokens. This prevents the race condition where two concurrent refresh
        // requests both pass validation and each create a new session. Only the
        // first caller claims the session; subsequent callers find it gone and
        // fail. If token generation fails after claiming, the user must
        // re-authenticate, which is preferable to session duplication.
        return this.sessionRepository
          .claimSessionForRefresh(record.id)
          .orElse((error) => {
            if (error.code === 'AUTH_REFRESH_TOKEN_INVALID') {
              this.logRefreshTokenInvalid(
                refreshTokenHash,
                'already-claimed-or-expired',
                record.userId,
              );
            }
            return errAsync(error);
          })
          .andThen(() => this.generateTokenPair(record.user, context));
      });
  }

  revoke(
    userId: string,
    refreshToken: string,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(
      this.prisma.$transaction(async (tx) => {
        const lucentResult =
          await this.sessionRepository.deleteSessionsByUserIdAndHash(
            userId,
            this.hashRefreshToken(refreshToken),
            tx,
          );

        if (lucentResult.isErr()) {
          throw new DomainFailureException(lucentResult.error);
        }

        const betterAuthResult =
          await this.betterAuthAdapter.revokeBetterAuthSessions(userId, tx);

        if (betterAuthResult.isErr()) {
          throw new DomainFailureException(betterAuthResult.error);
        }
      }),
      (error) => {
        if (error instanceof DomainFailureException) {
          return error.failure;
        }
        throw error;
      },
    ).map(() => undefined);
  }

  revokeAll(userId: string): ResultAsync<void, DomainFailure> {
    return fromPromise(
      this.prisma.$transaction(async (tx) => {
        const lucentResult =
          await this.sessionRepository.deleteSessionsByUserId(userId, tx);

        if (lucentResult.isErr()) {
          throw new DomainFailureException(lucentResult.error);
        }

        const betterAuthResult =
          await this.betterAuthAdapter.revokeBetterAuthSessions(userId, tx);

        if (betterAuthResult.isErr()) {
          throw new DomainFailureException(betterAuthResult.error);
        }
      }),
      (error) => {
        if (error instanceof DomainFailureException) {
          return error.failure;
        }
        throw error;
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
      })
      .andThen(() => this.betterAuthAdapter.revokeBetterAuthSessions(userId));
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
