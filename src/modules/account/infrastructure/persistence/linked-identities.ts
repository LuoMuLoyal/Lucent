import { Injectable } from '@nestjs/common';

import type { Prisma } from '#generated/prisma/client.js';
import {
  createDomainFailure,
  DomainFailureException,
} from '../../../../common/result/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import { CREDENTIAL_PROVIDER_ID } from '../../../auth/index.js';
import {
  IdentityUnlinkRejected,
  LinkedIdentities,
  type LinkedIdentityRow,
  type TransactionScope,
} from '../../application/ports/linked-identities.js';

/**
 * `LinkedIdentities` 端口的 Prisma 实现。
 *
 * ## 事务边界的归属
 *
 * `unlinkInTransaction` 自己开 `$transaction` 并把 `tx` 作为不透明
 * `TransactionScope` 传给 `hasPassword` 回调——**跨上下文读仍在同一事务里**，
 * 这是 `account.unlinkIdentity` 的既有约束（见 `application/use_cases/account.ts`
 * 里关于「一个事务只改一个聚合」的债务说明）。
 */
@Injectable()
export class PrismaLinkedIdentities extends LinkedIdentities {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listForUser(userId: string): Promise<LinkedIdentityRow[]> {
    try {
      return await this.prisma.account.findMany({
        where: { userId, providerId: { not: CREDENTIAL_PROVIDER_ID } },
        orderBy: { createdAt: 'asc' },
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to load linked identities');
    }
  }

  async listForUserInTransaction(
    scope: TransactionScope,
    userId: string,
  ): Promise<LinkedIdentityRow[]> {
    const tx = scope as Prisma.TransactionClient;
    return await tx.account.findMany({
      where: { userId, providerId: { not: CREDENTIAL_PROVIDER_ID } },
    });
  }

  async unlinkInTransaction(input: {
    userId: string;
    identityId: string;
    hasPassword: (scope: TransactionScope) => Promise<boolean>;
  }): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // 事务内重查：并发事务可能刚加了凭据、或刚删掉最后一个社交身份。
        const stillHasPassword = await input.hasPassword(tx);
        const remaining = await tx.account.findMany({
          where: {
            userId: input.userId,
            providerId: { not: CREDENTIAL_PROVIDER_ID },
          },
        });

        const target = remaining.find((item) => item.id === input.identityId);
        if (!target) {
          throw new IdentityUnlinkRejected('not-found');
        }
        if (!stillHasPassword && remaining.length <= 1) {
          throw new IdentityUnlinkRejected('last-identity');
        }

        const deleted = await tx.account.deleteMany({
          where: {
            id: input.identityId,
            userId: input.userId,
            providerId: { not: CREDENTIAL_PROVIDER_ID },
          },
        });
        if (deleted.count === 0) {
          throw new IdentityUnlinkRejected('not-found');
        }
      });
    } catch (error) {
      // 规则拒绝原样上抛（用例据此映射），基础设施故障折成依赖故障。
      if (error instanceof IdentityUnlinkRejected) throw error;
      throw infraFailure(error, 'Failed to unlink identity');
    }
  }
}

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
