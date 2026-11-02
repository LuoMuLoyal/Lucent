import { Injectable } from '@nestjs/common';

import type { User } from '#generated/prisma/client.js';
import {
  createDomainFailure,
  DomainFailureException,
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { UserService } from '../../../user/index.js';
import { AccountIdentity } from '../ports/account-identity.js';
import type {
  AccountProfile,
  UnlinkIdentityCommand,
  UpdateAccountCommand,
} from '../commands/account.js';
import {
  IdentityUnlinkRejected,
  LinkedIdentities,
  type LinkedIdentityRow,
} from '../ports/linked-identities.js';

type AccountUser = User & { identities: LinkedIdentityRow[] };

/**
 * 账户档案的读改写 —— `account` 上下文的唯一用例。
 *
 * ## 分层
 *
 * 编排 + 投影。IO 走端口（`LinkedIdentities` / `UserService` /
 * `AuthIdentityService` / `PasswordReauthService`），**不直连 Prisma**
 * （`arch:check` 的 `ddd-application-no-direct-prisma` 会拦）。
 *
 * ## 为什么不建 `domain/` 聚合
 *
 * 「账户档案」没有独立于 `user` 表的不变量：改昵称、改头像都是字段写入，
 * 读档案是投影。唯一有规则的 `unlinkIdentity` 依赖**跨上下文事实**
 * （「是否有密码」在 auth 上下文），那是用例级策略而非聚合不变量——
 * 把它塞进聚合会逼聚合去读另一个上下文。
 */
@Injectable()
export class Account {
  constructor(
    private readonly userService: UserService,
    private readonly identities: LinkedIdentities,
    private readonly identity: AccountIdentity,
  ) {}

  /** 读账户档案。 */
  get(userId: string): ResultAsync<AccountProfile, DomainFailure> {
    return this.loadAccountUser(userId).andThen((user) =>
      this.identity
        .hasPassword(userId)
        .map((hasPassword) => this.toProfile(user, hasPassword)),
    );
  }

  /** 改昵称/头像；空串表示清空。成功后回读档案。 */
  update(
    userId: string,
    command: UpdateAccountCommand,
  ): ResultAsync<AccountProfile, DomainFailure> {
    const nickname = command.nickname === '' ? null : command.nickname;
    const avatar = command.avatar === '' ? null : command.avatar;

    return this.loadAccountUser(userId)
      .andThen(() =>
        this.userService.update(userId, {
          ...(nickname !== undefined && { nickname }),
          ...(avatar !== undefined && { avatar }),
        }),
      )
      .andThen(() => this.get(userId));
  }

  /**
   * 解绑一个第三方身份。
   *
   * ## 为什么先重验密码
   *
   * 解绑会削弱账号的可登录方式，属于敏感操作——要求密码重验，与改密/删号
   * 同一档。没有密码的账号（纯 OAuth）会被 `PasswordReauthService` 拒绝。
   *
   * ## 为什么规则要查两遍
   *
   * 先读一遍给出快速失败（省一次事务），再在事务里重查一遍。中间可能发生
   * 的并发事件：用户恰好设置了密码（→ 允许解绑），或恰好删了最后一个社交
   * 身份（→ 禁止解绑）。**最终裁决在事务内**，由
   * `LinkedIdentities.unlinkInTransaction` 完成；用例只映射结果。
   */
  unlinkIdentity(
    userId: string,
    identityId: string,
    command: UnlinkIdentityCommand,
  ): ResultAsync<AccountProfile, DomainFailure> {
    return this.loadAccountUser(userId)
      .andThen((user) =>
        this.identity.verifyPassword(userId, command.password).map(() => user),
      )
      .andThen((user) =>
        this.identity
          .hasPassword(userId)
          .map((hasPassword) => ({ user, hasPassword })),
      )
      .andThen(({ user, hasPassword }) => {
        // 快速失败：纯 OAuth 账号没有密码，说明这是它唯一的登录方式。
        // 「是否只剩一个身份」由事务内判定，这里只挡明显不可能的路径。
        if (!hasPassword && user.identities.length <= 1) {
          return errAsync(
            createDomainFailure({ kind: 'authorization', code: 'FORBIDDEN' }),
          );
        }
        if (!user.identities.some((item) => item.id === identityId)) {
          return errAsync(
            createDomainFailure({
              kind: 'not_found',
              code: 'RESOURCE_NOT_FOUND',
            }),
          );
        }
        return fromPromise(
          this.identities.unlinkInTransaction({
            userId,
            identityId,
            hasPassword: async (scope) => {
              const result = await this.identity.hasPassword(userId, scope);
              // **Err 必须抛出，不能折成 `false`。** 折成 false 会让人以为
              // 「没有密码」，从而错误触发 FORBIDDEN 守卫，把一个依赖故障
              // 伪装成授权失败——那会误导用户以为自己的账号有问题。
              // 抛出让事务回滚，再由 `mapUnlinkFailure` 映射成依赖故障。
              if (result.isErr()) {
                throw new DomainFailureException(result.error);
              }
              return result.value;
            },
          }),
          (error) => this.mapUnlinkFailure(error),
        ).andThen(() => this.get(userId));
      });
  }

  /** 「无此身份」→ 404；「最后一个登录方式」→ 403；其他 → 依赖故障。 */
  private mapUnlinkFailure(error: unknown): DomainFailure {
    if (error instanceof IdentityUnlinkRejected) {
      return error.reason === 'not-found'
        ? createDomainFailure({ kind: 'not_found', code: 'RESOURCE_NOT_FOUND' })
        : createDomainFailure({ kind: 'authorization', code: 'FORBIDDEN' });
    }
    return mapUnknownToDependencyFailure(error, 'Failed to unlink identity');
  }

  private loadAccountUser(
    userId: string,
  ): ResultAsync<AccountUser, DomainFailure> {
    return fromPromise(this.userService.findById(userId), (error) =>
      mapUnknownToDependencyFailure(
        error,
        'Failed to load user for account operation',
      ),
    ).andThen((user) => {
      if (!user) {
        return errAsync(
          createDomainFailure({
            kind: 'not_found',
            code: 'RESOURCE_NOT_FOUND',
          }),
        );
      }
      return fromPromise(this.identities.listForUser(userId), (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Failed to load linked identities',
        ),
      ).map((identities) => ({ ...user, identities }));
    });
  }

  private toProfile(user: AccountUser, hasPassword: boolean): AccountProfile {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      emailVerifiedAt: this.formatDateTime(user.emailVerifiedAt),
      hasPassword,
      lastLoginAt: this.formatDateTime(user.lastLoginAt),
      linkedIdentities: user.identities.map((identity) => ({
        id: identity.id,
        provider: identity.providerId,
        email: identity.providerEmail,
        emailVerifiedAt: this.formatDateTime(identity.providerEmailVerifiedAt),
        linkedAt: identity.createdAt.toISOString(),
      })),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private formatDateTime(value: Date | null): string | null {
    return value?.toISOString() ?? null;
  }
}
