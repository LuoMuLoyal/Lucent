/**
 * Repository abstraction for UserSession data access.
 *
 * Decouples AuthTokenService from direct PrismaService usage.
 */
import { Injectable } from '@nestjs/common';
import type { Prisma, UserSession, User } from '#generated/prisma/client.js';
import { PrismaService } from '../../../prisma/index.js';
import { fromPrismaResult, now } from '../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';

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
  /** Token family root; shared by every session produced by rotations. */
  familyId: string;
  /** When this refresh token was exchanged away (`null` = still usable). */
  rotatedAt: Date | null;
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
    /** Caller-supplied id: a brand-new family uses its own id as `familyId`. */
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    lastUsedAt: Date;
    /** Token family root. A fresh login starts a family; a rotation joins one. */
    familyId: string;
    context?: SessionContextData;
  }): Promise<void>;

  abstract findSessionByRefreshTokenHash(
    hash: string,
  ): ResultAsync<SessionWithUser, DomainFailure>;

  abstract deleteSessionById(id: string): Promise<void>;

  /**
   * Atomically claims a session for token refresh by stamping `rotatedAt` only
   * if it is still usable (not rotated, not revoked, not expired). Resolves ok
   * only if this caller won the claim; a loser gets
   * `AUTH_REFRESH_TOKEN_INVALID` and the caller decides whether that was a
   * benign race or a replay (see `AuthTokenService.rotateSession`).
   *
   * The row is **kept** rather than deleted: a deleted row would make an
   * already-rotated token indistinguishable from an unknown one, which is
   * exactly the signal reuse detection needs.
   */
  abstract claimSessionForRefresh(id: string): ResultAsync<void, DomainFailure>;

  /**
   * Revokes every still-active session in one token family and reports how many
   * were revoked.
   *
   * Called when an already-rotated refresh token is replayed outside the
   * concurrency grace window: two parties hold the same chain, so the whole
   * chain — including whatever a thief obtained — is terminated.
   */
  abstract revokeSessionFamily(
    userId: string,
    familyId: string,
  ): ResultAsync<number, DomainFailure>;

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
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    lastUsedAt: Date;
    familyId: string;
    context?: SessionContextData;
  }): Promise<void> {
    const data: Prisma.UserSessionCreateInput = {
      id: input.id,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      lastUsedAt: input.lastUsedAt,
      familyId: input.familyId,
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
      this.prisma.userSession.updateMany({
        // `rotatedAt: null` is the atomic guard: only one caller can flip it.
        where: {
          id,
          rotatedAt: null,
          revokedAt: null,
          expiresAt: { gt: now() },
        },
        data: { rotatedAt: now() },
      }),
    ).andThen((result) =>
      result.count > 0
        ? okAsync(undefined)
        : errAsync(this.refreshTokenInvalidFailure()),
    );
  }

  revokeSessionFamily(
    userId: string,
    familyId: string,
  ): ResultAsync<number, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userSession.updateMany({
        where: { userId, familyId, revokedAt: null },
        data: { revokedAt: now() },
      }),
    ).map((result) => result.count);
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
        // Rotated rows are tombstones for reuse detection, not live sessions.
        where: {
          userId,
          revokedAt: null,
          rotatedAt: null,
          expiresAt: { gt: now() },
        },
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
