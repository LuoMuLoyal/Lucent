import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { I18nService } from 'nestjs-i18n';
import { User } from '#generated/prisma/client';
import { ConfigKey } from '../../../config/env/config-keys.enum';

import { now } from '../../../common';
import type {
  AuthRequestContext,
  TokenPair,
  UserPayload,
} from '../types/auth-request';
import {
  AuthSessionRepositoryPort,
  type SessionContextData,
} from '../repositories/session.repository';

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
    private readonly i18n: I18nService,
  ) {}

  private get jwtConfig(): JwtConfigShape {
    return this.configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);
  }

  async generateTokenPair(
    user: User,
    context?: AuthRequestContext,
  ): Promise<TokenPair> {
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
    await this.sessionRepository.createSession(sessionInput);

    let accessToken: string;
    try {
      accessToken = await this.jwtService.signAsync(payload, {
        secret: config.accessSecret,
        expiresIn: config.accessTtl,
        algorithm: 'HS512',
        jwtid: accessTokenId,
        issuer: config.issuer,
        audience: config.audience,
      });
    } catch (error) {
      this.logger.error(
        `JWT signing failed for user ${user.id} after session creation: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(
        now + accessTokenExpiresInMs,
      ).toISOString(),
      refreshTokenExpiresAt: new Date(
        now + refreshTokenExpiresInMs,
      ).toISOString(),
    };
  }

  async refresh(
    refreshToken: string,
    context?: AuthRequestContext,
  ): Promise<TokenPair> {
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const record =
      await this.sessionRepository.findSessionByRefreshTokenHash(
        refreshTokenHash,
      );

    if (!record || record.expiresAt < now() || record.revokedAt !== null) {
      throw new Error('REFRESH_TOKEN_INVALID');
    }

    // Atomically claim the session by deleting it before generating new tokens.
    // This prevents the race condition where two concurrent refresh requests
    // both pass validation and each create a new session. Only the first
    // caller claims the session; subsequent callers find it gone and fail.
    // If token generation fails after claiming, the user must re-authenticate,
    // which is preferable to session duplication.
    const claimed = await this.sessionRepository.claimSessionForRefresh(
      record.id,
    );
    if (!claimed) {
      throw new Error('REFRESH_TOKEN_INVALID');
    }

    const tokens = await this.generateTokenPair(record.user, context);
    return tokens;
  }

  async revoke(userId: string, refreshToken: string): Promise<void> {
    await this.sessionRepository.deleteSessionsByUserIdAndHash(
      userId,
      this.hashRefreshToken(refreshToken),
    );
  }

  async revokeAll(userId: string): Promise<void> {
    await this.sessionRepository.deleteSessionsByUserId(userId);
  }

  async revokeById(
    userId: string,
    sessionId: string,
    locale: string = 'en',
  ): Promise<void> {
    const record = await this.sessionRepository.findSessionById(sessionId);
    if (!record) {
      throw new NotFoundException(
        this.i18n.t('auth.session_not_found', { lang: locale }),
      );
    }
    if (record.userId !== userId) {
      throw new ForbiddenException(
        this.i18n.t('auth.cannot_revoke_another_user_session', {
          lang: locale,
        }),
      );
    }
    await this.sessionRepository.revokeSessionById(sessionId);
  }

  async listSessions(userId: string): Promise<
    Array<{
      id: string;
      deviceType: string | null;
      deviceName: string | null;
      platform: string | null;
      lastUsedAt: string | null;
      createdAt: string;
      expiresAt: string;
      isCurrent: boolean;
    }>
  > {
    const records = await this.sessionRepository.listActiveSessions(userId);
    return records.map((record) => ({
      id: record.id,
      deviceType: record.deviceType,
      deviceName: record.deviceName,
      platform: record.platform,
      lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      isCurrent: false,
    }));
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
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
