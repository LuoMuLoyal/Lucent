import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { Prisma } from '#generated/prisma/client.js';
import { UserStatus } from '#generated/prisma/client.js';
import {
  createDomainFailure,
  DomainFailureException,
} from '../../../../common/result/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import {
  Accounts,
  type CreateLocalAccountResult,
  type LocalCredentialAccount,
} from '../../domain/account/accounts.js';
import { toStoredPassword } from '../../domain/account/password-hash.js';
import type { TransactionScope } from '../../domain/account/transaction-scope.js';

/** `providerId` of the local email+password identity. */
export const CREDENTIAL_PROVIDER_ID = 'credential';

/** `issuer` recorded on local email+password identities. */
export const LOCAL_CREDENTIAL_ISSUER = 'local:credential';

/**
 * `Accounts` 端口的 Prisma 实现。
 *
 * ## 身份层的两条分流
 *
 * 本地凭据身份是**单行** `providerId = 'credential'`（`issuer` 为
 * `local:credential`，`accountId` 即 userId，一个用户至多一条）；每个 OAuth
 * 链接各是一条独立身份行。本类只管前者，OAuth 行由 S4 的
 * `infrastructure/oauth/` 写。
 *
 * ## 事务句柄怎么用
 *
 * 端口签名收的是不透明的 `TransactionScope`；这里在**入口处**做一次 cast
 * 收敛成 Prisma 客户端。应用层因此不必 import Prisma（分层护栏要求）。
 */
@Injectable()
export class PrismaAccounts extends Accounts {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByEmail(email: string): Promise<LocalCredentialAccount | null> {
    try {
      const record = await this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          status: true,
          accounts: {
            where: { providerId: CREDENTIAL_PROVIDER_ID },
            select: { password: true },
            take: 1,
          },
        },
      });
      if (record === null) return null;

      return {
        userId: record.id,
        email: record.email,
        status: record.status,
        password: toStoredPassword(record.accounts[0]?.password),
      };
    } catch (error) {
      throw infraFailure(error, 'Failed to load account by email');
    }
  }

  async findByUserId(userId: string): Promise<LocalCredentialAccount | null> {
    try {
      const record = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          status: true,
          accounts: {
            where: { providerId: CREDENTIAL_PROVIDER_ID },
            select: { password: true },
            take: 1,
          },
        },
      });
      if (record === null) return null;

      return {
        userId: record.id,
        email: record.email,
        status: record.status,
        password: toStoredPassword(record.accounts[0]?.password),
      };
    } catch (error) {
      throw infraFailure(error, 'Failed to load account by user id');
    }
  }

  /**
   * 建号：`users` + `accounts` 两行，**同一事务**。
   *
   * 邮箱已存在时返回 `{ created: false }` 与既有 userId，不抛错——注册接口
   * 若在这里报「邮箱已占用」，就给了攻击者一个可枚举的差异（反枚举）。
   *
   * 先查后建放在一个事务里，是因为两个并发注册同一邮箱时，唯一索引会让其中
   * 一个失败；事务 + 唯一约束的组合让「查不到就建」这个判断不会出现竞态窗口。
   */
  async createLocalAccount(input: {
    email: string;
    passwordHash: string;
    nickname?: string;
  }): Promise<CreateLocalAccountResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        });
        if (existing !== null) {
          return { userId: existing.id, created: false };
        }

        const user = await tx.user.create({
          data: {
            email: input.email,
            ...(input.nickname !== undefined && { nickname: input.nickname }),
            profile: { create: {} },
          },
          select: { id: true },
        });

        await tx.account.create({
          data: {
            id: randomUUID(),
            userId: user.id,
            issuer: LOCAL_CREDENTIAL_ISSUER,
            providerId: CREDENTIAL_PROVIDER_ID,
            accountId: user.id,
            password: input.passwordHash,
          },
        });

        return { userId: user.id, created: true };
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to create local account');
    }
  }

  async replacePassword(
    userId: string,
    passwordHash: string,
    tx?: TransactionScope,
  ): Promise<void> {
    const client = toClient(tx) ?? this.prisma;
    try {
      await client.account.upsert({
        where: {
          providerId_accountId: {
            providerId: CREDENTIAL_PROVIDER_ID,
            accountId: userId,
          },
        },
        update: { password: passwordHash },
        create: {
          userId,
          issuer: LOCAL_CREDENTIAL_ISSUER,
          providerId: CREDENTIAL_PROVIDER_ID,
          accountId: userId,
          password: passwordHash,
        },
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to store credential account');
    }
  }

  async hasPassword(userId: string, tx?: TransactionScope): Promise<boolean> {
    const client = toClient(tx) ?? this.prisma;
    try {
      const account = await client.account.findFirst({
        where: { userId, providerId: CREDENTIAL_PROVIDER_ID },
        select: { password: true },
      });
      return account?.password !== null && account?.password !== undefined;
    } catch (error) {
      throw infraFailure(error, 'Failed to check credential account');
    }
  }

  async softDeleteUser(userId: string, deletedAt: Date): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { deletedAt, status: UserStatus.deleted },
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to soft-delete user');
    }
  }

  async markEmailVerified(userId: string, at: Date): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { emailVerified: true, emailVerifiedAt: at },
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to mark email verified');
    }
  }
}

/**
 * 不透明句柄 → Prisma 客户端。
 *
 * 这是**唯一**允许把 `TransactionScope` 解释成 Prisma 类型的地方。端口之所以
 * 收不透明句柄，是为了让应用层不必 import `@prisma/client`（分层护栏）；
 * 不透明性在实现层的入口处结束。
 */
function toClient(
  tx: TransactionScope | undefined,
): Prisma.TransactionClient | null {
  return tx === undefined ? null : (tx as Prisma.TransactionClient);
}

/**
 * 把 Prisma 故障折成**真实的 Error** 抛出。
 *
 * 端口返回 Promise 而不是 Result：失败要在应用层被 `fromPromise` 与
 * `mapUnknownToDependencyFailure` 统一抬进 Result 通道，因此这里抛
 * `DomainFailureException`（`only-throw-error` 要求 Error 实例），由上层
 * mapper 还原成 `DEPENDENCY_UNAVAILABLE`——绝不折叠成「密码错」。
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
