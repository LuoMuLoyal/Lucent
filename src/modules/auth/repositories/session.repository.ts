/**
 * Repository abstraction for UserSession data access.
 *
 * Decouples AuthTokenService from direct PrismaService usage.
 */
import { Injectable } from '@nestjs/common';
import type { Prisma, UserSession, User } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma';
import { fromPrismaResult, now } from '../../../common';
import {
  createDomainFailure,
  errAsync,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';

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
  ): ResultAsync<SessionWithUser, DomainFailure>;

  abstract deleteSessionById(id: string): Promise<void>;

  /**
   * Atomically claims a session for token refresh by deleting it only if it is
   * still valid (not revoked, not expired). Resolves ok only if the session was
   * claimed; a session that was already claimed/revoked/expired maps to
   * `AUTH_REFRESH_TOKEN_INVALID`.
   *
   * This prevents the race condition where two concurrent refresh requests
   * both pass validation and each generate a new session.
   */
  abstract claimSessionForRefresh(id: string): ResultAsync<void, DomainFailure>;

  abstract deleteSessionsByUserIdAndHash(
    userId: string,
    hash: string,
    tx?: Prisma.TransactionClient,
  ): ResultAsync<void, DomainFailure>;

  abstract deleteSessionsByUserId(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): ResultAsync<void, DomainFailure>;

  abstract findSessionById(
    sessionId: string,
  ): ResultAsync<UserSession, DomainFailure>;

  abstract revokeSessionById(id: string): ResultAsync<void, DomainFailure>;

  abstract listActiveSessions(
    userId: string,
  ): ResultAsync<SessionListRow[], DomainFailure>;
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

  findSessionByRefreshTokenHash(
    hash: string,
  ): ResultAsync<SessionWithUser, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userSession.findUnique({
        where: { refreshTokenHash: hash },
        include: { user: true },
      }),
    ).andThen((record) =>
      record == null
        ? errAsync(this.refreshTokenInvalidFailure())
        : okAsync(record),
    );
  }

  async deleteSessionById(id: string): Promise<void> {
    await this.prisma.userSession.delete({ where: { id } });
  }

  claimSessionForRefresh(id: string): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userSession.deleteMany({
        where: { id, revokedAt: null, expiresAt: { gt: now() } },
      }),
    ).andThen((result) =>
      result.count > 0
        ? okAsync(undefined)
        : errAsync(this.refreshTokenInvalidFailure()),
    );
  }

  deleteSessionsByUserIdAndHash(
    userId: string,
    hash: string,
    tx?: Prisma.TransactionClient,
  ): ResultAsync<void, DomainFailure> {
    const client = tx ?? this.prisma;
    return fromPrismaResult(
      client.userSession.deleteMany({
        where: { userId, refreshTokenHash: hash },
      }),
    ).map(() => undefined);
  }

  deleteSessionsByUserId(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): ResultAsync<void, DomainFailure> {
    const client = tx ?? this.prisma;
    return fromPrismaResult(
      client.userSession.deleteMany({ where: { userId } }),
    ).map(() => undefined);
  }

  findSessionById(sessionId: string): ResultAsync<UserSession, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userSession.findUnique({
        where: { id: sessionId },
      }),
    ).andThen((record) =>
      record == null
        ? errAsync(this.sessionNotFoundFailure())
        : okAsync(record),
    );
  }

  revokeSessionById(id: string): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userSession.update({
        where: { id },
        data: { revokedAt: now() },
      }),
    ).map(() => undefined);
  }

  listActiveSessions(
    userId: string,
  ): ResultAsync<SessionListRow[], DomainFailure> {
    return fromPrismaResult(
      this.prisma.userSession.findMany({
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
      }),
    );
  }

  private refreshTokenInvalidFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'authentication',
      code: 'AUTH_REFRESH_TOKEN_INVALID',
    });
  }

  private sessionNotFoundFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'authentication',
      code: 'AUTH_SESSION_NOT_FOUND',
    });
  }
}
