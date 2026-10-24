import { Injectable } from '@nestjs/common';

import type { Prisma } from '#generated/prisma/client.js';
import {
  createDomainFailure,
  DomainFailureException,
} from '../../../../common/result/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import {
  Sessions,
  type ActiveSessionRow,
  type NewSessionInput,
  type SessionForRefresh,
} from '../../domain/session/sessions.js';

/**
 * `Sessions` 端口的 Prisma 实现。
 *
 * ## 只做映射，不做判断
 *
 * 这里没有「这条 token 还能不能换」——那是领域判定
 * （`domain/session/session.ts` 的 `decideRefresh`）。本类只保证三件存储事实：
 *
 * - 查不到返回 `null`（不是错误：领域层要把「不存在」并进反枚举桶）；
 * - 认领是**原子**的（`rotatedAt IS NULL` 进 WHERE 子句）；
 * - 轮换掉的行走保留为 tombstone，只有登出/改密才物理删除。
 *
 * ## 错误语义
 *
 * Prisma 的异常（连接断、约束冲突）折成 `DEPENDENCY_UNAVAILABLE`，
 * 与「token 无效」严格分开。这条分界是安全保证（见 `credential-failure.ts`）。
 */
@Injectable()
export class PrismaSessions extends Sessions {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  create(input: NewSessionInput): Promise<void> {
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

    return this.prisma.userSession
      .create({ data })
      .then((): void => undefined)
      .catch((error: unknown) => {
        throw infraFailure(error, 'Failed to create session');
      });
  }

  async findByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<SessionForRefresh | null> {
    try {
      const record = await this.prisma.userSession.findUnique({
        where: { refreshTokenHash },
        select: SESSION_FOR_REFRESH_SELECT,
      });
      return record ?? null;
    } catch (error) {
      throw infraFailure(error, 'Failed to load session by refresh token');
    }
  }

  async findById(id: string): Promise<SessionForRefresh | null> {
    try {
      const record = await this.prisma.userSession.findUnique({
        where: { id },
        select: SESSION_FOR_REFRESH_SELECT,
      });
      return record ?? null;
    } catch (error) {
      throw infraFailure(error, 'Failed to load session');
    }
  }

  async claimForRefresh(id: string, at: Date): Promise<boolean> {
    try {
      const result = await this.prisma.userSession.updateMany({
        // `rotatedAt: null` 是原子闸门：并发 refresh 里只有一个能把
        // `rotatedAt` 从 NULL 翻成当前时刻。
        where: {
          id,
          rotatedAt: null,
          revokedAt: null,
          expiresAt: { gt: at },
        },
        data: { rotatedAt: at },
      });
      return result.count > 0;
    } catch (error) {
      throw infraFailure(error, 'Failed to claim session for refresh');
    }
  }

  async revokeFamily(
    userId: string,
    familyId: string,
    at: Date,
  ): Promise<number> {
    try {
      const result = await this.prisma.userSession.updateMany({
        where: { userId, familyId, revokedAt: null },
        data: { revokedAt: at },
      });
      return result.count;
    } catch (error) {
      throw infraFailure(error, 'Failed to revoke session family');
    }
  }

  async revokeById(id: string, at: Date): Promise<void> {
    try {
      await this.prisma.userSession.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: at },
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to revoke session');
    }
  }

  async deleteByUserIdAndHash(userId: string, hash: string): Promise<void> {
    try {
      await this.prisma.userSession.deleteMany({
        where: { userId, refreshTokenHash: hash },
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to delete session');
    }
  }

  async deleteAllForUser(userId: string): Promise<void> {
    try {
      await this.prisma.userSession.deleteMany({ where: { userId } });
    } catch (error) {
      throw infraFailure(error, 'Failed to delete sessions');
    }
  }

  async listActive(userId: string): Promise<ActiveSessionRow[]> {
    try {
      return await this.prisma.userSession.findMany({
        // 轮换掉的 tombstone 不是活会话，不进设备清单。
        where: {
          userId,
          revokedAt: null,
          rotatedAt: null,
          expiresAt: { gt: new Date() },
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
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to list sessions');
    }
  }
}

/**
 * refresh 判定只需要这几列；`user` 不取（应用层另查账户）。
 */
const SESSION_FOR_REFRESH_SELECT = {
  id: true,
  userId: true,
  familyId: true,
  expiresAt: true,
  revokedAt: true,
  rotatedAt: true,
} as const;

/**
 * 把 Prisma 故障折成一个**真实的 Error** 抛出。
 *
 * 仓储端口的方法返回 Promise 而不是 Result：失败要在应用层被 `fromPromise`
 * 与 `mapUnknownToDependencyFailure` 统一抬进 Result 通道，所以这里抛
 * `DomainFailureException`（`only-throw-error` 要求 Error 实例），由上层
 * mapper 还原成 `DEPENDENCY_UNAVAILABLE`——绝不会折叠成「token 无效」。
 */
function infraFailure(error: unknown, context: string): Error {
  return new DomainFailureException(
    createDomainFailure({
      kind: 'dependency',
      code: 'DEPENDENCY_UNAVAILABLE',
      detail: context,
      cause: error,
    }),
  );
}
