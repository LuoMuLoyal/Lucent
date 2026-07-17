/**
 * Repository abstraction for UserSession data access.
 *
 * Decouples AuthTokenService from direct PrismaService usage.
 */
import { Injectable } from '@nestjs/common';
import type { Prisma, UserSession, User } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { now } from '../../../common/helpers/date-time.utils';

export interface SessionContextData {
  ipAddress?: string;
  userAgent?: string;
}

export interface SessionWithUser {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: User;
}

export interface SessionListRow {
  id: string;
  userId: string;
  deviceType: string | null;
  deviceName: string | null;
  platform: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
}

export abstract class AuthSessionRepositoryPort {
  abstract createSession(input: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    lastUsedAt: Date;
    context?: SessionContextData;
  }): Promise<void>;

  abstract findSessionByRefreshTokenHash(
    hash: string,
  ): Promise<SessionWithUser | null>;

  abstract deleteSessionById(id: string): Promise<void>;

  /**
   * Atomically claims a session for token refresh by deleting it only if it is
   * still valid (not revoked, not expired). Returns true if the session was
   * claimed, false if it was already claimed/revoked/expired.
   *
   * This prevents the race condition where two concurrent refresh requests
   * both pass validation and each generate a new session.
   */
  abstract claimSessionForRefresh(id: string): Promise<boolean>;

  abstract deleteSessionsByUserIdAndHash(
    userId: string,
    hash: string,
  ): Promise<void>;

  abstract deleteSessionsByUserId(userId: string): Promise<void>;

  abstract findSessionById(sessionId: string): Promise<UserSession | null>;

  abstract revokeSessionById(id: string): Promise<void>;

  abstract listActiveSessions(userId: string): Promise<SessionListRow[]>;
}

@Injectable()
export class AuthSessionRepository implements AuthSessionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(input: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    lastUsedAt: Date;
    context?: SessionContextData;
  }): Promise<void> {
    const data: Prisma.UserSessionCreateInput = {
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      lastUsedAt: input.lastUsedAt,
      ...(input.context?.ipAddress !== undefined && {
        ipAddress: input.context.ipAddress,
      }),
      ...(input.context?.userAgent !== undefined && {
        userAgent: input.context.userAgent,
      }),
      user: { connect: { id: input.userId } },
    };

    await this.prisma.userSession.create({ data });
  }

  async findSessionByRefreshTokenHash(
    hash: string,
  ): Promise<SessionWithUser | null> {
    return this.prisma.userSession.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: true },
    });
  }

  async deleteSessionById(id: string): Promise<void> {
    await this.prisma.userSession.delete({ where: { id } });
  }

  async claimSessionForRefresh(id: string): Promise<boolean> {
    const result = await this.prisma.userSession.deleteMany({
      where: { id, revokedAt: null, expiresAt: { gt: now() } },
    });
    return result.count > 0;
  }

  async deleteSessionsByUserIdAndHash(
    userId: string,
    hash: string,
  ): Promise<void> {
    await this.prisma.userSession.deleteMany({
      where: { userId, refreshTokenHash: hash },
    });
  }

  async deleteSessionsByUserId(userId: string): Promise<void> {
    await this.prisma.userSession.deleteMany({ where: { userId } });
  }

  async findSessionById(sessionId: string): Promise<UserSession | null> {
    return this.prisma.userSession.findUnique({
      where: { id: sessionId },
    });
  }

  async revokeSessionById(id: string): Promise<void> {
    await this.prisma.userSession.update({
      where: { id },
      data: { revokedAt: now() },
    });
  }

  async listActiveSessions(userId: string): Promise<SessionListRow[]> {
    return this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now() } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        userId: true,
        deviceType: true,
        deviceName: true,
        platform: true,
        lastUsedAt: true,
        createdAt: true,
        expiresAt: true,
      },
    });
  }
}
