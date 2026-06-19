import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { User } from '../../generated/prisma/client';
import { ConfigKey } from '../../config/config-keys.enum';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface UserPayload {
  sub: string;
  email: string | null;
}

export interface AuthRequestContext {
  ipAddress?: string;
  userAgent?: string;
}

interface JwtConfigShape {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: number;
  refreshTtl: number;
}

@Injectable()
export class AuthTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private get jwtConfig(): JwtConfigShape {
    return this.configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);
  }

  async generateTokenPair(
    user: User,
    context?: AuthRequestContext,
  ): Promise<TokenPair> {
    const config = this.jwtConfig;
    const payload: UserPayload = { sub: user.id, email: user.email };

    const accessTokenId = randomBytes(16).toString('hex');
    const refreshToken = randomBytes(32).toString('hex');
    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    const now = Date.now();
    const accessTokenExpiresInMs = config.accessTtl * 1000;
    const refreshTokenExpiresInMs = config.refreshTtl * 1000;

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: config.accessSecret,
      expiresIn: config.accessTtl,
      algorithm: 'HS512',
      jwtid: accessTokenId,
    });

    await this.prisma.userSession.create({
      data: {
        refreshTokenHash,
        expiresAt: new Date(now + refreshTokenExpiresInMs),
        lastUsedAt: new Date(now),
        ...this.getSessionContextData(context),
        user: { connect: { id: user.id } },
      },
    });

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
    const record = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash },
      include: { user: true },
    });

    if (!record || record.expiresAt < new Date() || record.revokedAt !== null) {
      throw new Error('REFRESH_TOKEN_INVALID');
    }

    await this.prisma.userSession.delete({ where: { id: record.id } });
    return this.generateTokenPair(record.user, context);
  }

  async revoke(userId: string, refreshToken: string): Promise<void> {
    await this.prisma.userSession.deleteMany({
      where: { userId, refreshTokenHash: this.hashRefreshToken(refreshToken) },
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.userSession.deleteMany({ where: { userId } });
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private getSessionContextData(context: AuthRequestContext | undefined): {
    ipAddress?: string;
    userAgent?: string;
  } {
    return {
      ...(context?.ipAddress !== undefined && { ipAddress: context.ipAddress }),
      ...(context?.userAgent !== undefined && { userAgent: context.userAgent }),
    };
  }
}
