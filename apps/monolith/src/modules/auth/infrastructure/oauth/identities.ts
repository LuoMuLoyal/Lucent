import { randomUUID } from 'node:crypto';
import {
  normalizeEmail,
  fromPrismaResult,
  toInputJsonValue,
} from '../../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { Injectable } from '@nestjs/common';

import { Prisma, User, UserStatus } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import type { OAuthProviderProfile } from '../../application/ports/oauth-provider.js';
import { toOAuthIdentity } from './profile-mapping.js';
import {
  canExplicitlyLink,
  decideOAuthAccount,
  normalizedIdentityEmail,
  type OAuthAccountFacts,
  type OAuthIdentity,
} from '../../domain/account/oauth-identity.js';

/**
 * OAuth 身份 → 账号归属的**持久化与执行**。
 *
 * ## 判定不在这个类里
 *
 * 「这次 OAuth 登录该挂到哪个账号」是领域规则
 * （`domain/account/oauth-identity.ts` 的 `decideOAuthAccount` /
 * `canExplicitlyLink`）。本类负责**取事实**（三个 `find*` 查询）与
 * **执行决定**（建账号 / 建身份行）。
 *
 * ## 为什么这个类曾经有两套并行实现
 *
 * 在 S4 之前，归属判定是内联在这里的 `matchByUnionIdOrEmail` /
 * `matchByEmail`。S4 把规则提成了领域函数并配了纯单测，**但当时没接线**，
 * 于是同一个判断在两处各存在一份——测试测的是没人调用的那份。
 * 2026-10-25 接线：内联实现已删除，本类改为调用领域规则。
 *
 * ## 输入形状
 *
 * 收 `OAuthProfile`（应用层归一化形状），经 ACL `toOAuthIdentity` 翻成领域
 * `OAuthIdentity` 后再判定。**领域层不认识 `OAuthProfile`。**
 */
@Injectable()
export class AuthOAuthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 找到或新建 OAuth 用户。
   *
   * 先取三个事实（已有身份行 / unionId 命中 / 邮箱命中），交给
   * `decideOAuthAccount` 判定，再执行决定。
   */
  findOrCreateOAuthUser(
    profile: OAuthProviderProfile,
  ): ResultAsync<User, DomainFailure> {
    const identity = toOAuthIdentity(profile);

    return this.loadAccountFacts(identity).andThen((facts) => {
      const decision = decideOAuthAccount(identity, facts);

      switch (decision.kind) {
        case 'link-existing':
          // 已有身份行：直接返回，不再写任何行。
          if (decision.reason === 'identity-already-linked') {
            return this.requireUser(facts.linkedUserId);
          }
          // 按 unionId / 受信邮箱命中：补一条身份行，复用既有用户。
          return this.createAccount(decision.userId, profile).andThen(() =>
            this.requireUser(decision.userId),
          );
        case 'create-new':
          return this.createOAuthUser(profile);
      }
    });
  }

  /**
   * 更新登录后的用户信息（最近登录时间、恢复 active、昵称/头像同步）。
   *
   * 不属于归属判定，保持原样。
   */
  updateOAuthLoginUser(
    user: User,
    profile: OAuthProviderProfile,
  ): ResultAsync<User, DomainFailure> {
    return fromPrismaResult(
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          status: UserStatus.active,
          ...(profile.nickname !== undefined && { nickname: profile.nickname }),
          ...(profile.avatar !== undefined && { avatar: profile.avatar }),
        },
      }),
    );
  }

  /**
   * 把一个 OAuth 身份显式链接到指定账号。
   *
   * 判定在 `canExplicitlyLink`：受信提供商**不允许**显式链接（它们走登录
   * 自动关联），其余提供商要求身份未被别人占用。
   */
  linkOAuthProfileToUser(
    userId: string,
    profile: OAuthProviderProfile,
  ): ResultAsync<void, DomainFailure> {
    const identity = toOAuthIdentity(profile);

    return this.loadAccountFacts(identity).andThen((facts) => {
      const owner = facts.linkedUserId;
      if (!canExplicitlyLink(identity, owner, userId)) {
        return errAsync(this.identityInUse());
      }

      // 已属于自己：幂等成功，不再写行。
      if (owner !== null) return okAsync(undefined);

      // unionId 若被**另一个**账号占用，也是身份冲突。
      if (identity.unionId !== undefined && facts.unionUserId !== null) {
        if (facts.unionUserId !== userId) {
          return errAsync(this.identityInUse());
        }
        return this.createAccount(userId, profile).map(() => undefined);
      }

      return this.createAccount(userId, profile).map(() => undefined);
    });
  }

  // ── 事实查询 ─────────────────────────────────────────────────

  /**
   * 取归属判定需要的三个事实。
   *
   * **三次查询是分开的、且都是惰性的吗？** 不是——这里三个都查。理由：
   * 判定需要它们全部，而其中两个（unionId、email）本身就是可选条件，
   * 把它们做成条件查询会让「查了没查」取决于 profile 形状，
   * 反而难测。代价是每次登录至多三次主键/唯一索引查询。
   *
   * 邮箱查询用 `nonDeleted` 语义（`deletedAt: null`）——**已注销账号的邮箱
   * 因此查不到**，于是不会自动关联回旧账号（见 `decideOAuthAccount` 注释）。
   */
  private loadAccountFacts(
    identity: OAuthIdentity,
  ): ResultAsync<OAuthAccountFacts, DomainFailure> {
    const email = normalizedIdentityEmail(identity);

    return this.findAccountUser(identity.provider, identity.providerUserId)
      .andThen((linked) =>
        this.findUserByUnionId(identity.unionId).map((union) => ({
          linked,
          union,
        })),
      )
      .andThen(({ linked, union }) =>
        this.findUserByEmail(email).map((byEmail) => ({
          linkedUserId: linked?.id ?? null,
          unionUserId: union?.id ?? null,
          emailUserId: byEmail?.id ?? null,
        })),
      );
  }

  /** 按 `(provider, providerUserId)` 找身份行对应的用户。 */
  private findAccountUser(
    providerId: string,
    accountId: string,
  ): ResultAsync<User | null, DomainFailure> {
    return fromPromise(
      this.prisma.account.findFirst({
        where: {
          providerId,
          accountId,
          user: { deletedAt: null },
        },
        include: { user: true },
      }),
      (error) =>
        mapUnknownToDependencyFailure(error, 'Failed to load OAuth account'),
    ).map((account) => account?.user ?? null);
  }

  /** 按 `unionId` 找**同一自然人**的另一条身份行对应的用户。 */
  private findUserByUnionId(
    unionId: string | undefined,
  ): ResultAsync<User | null, DomainFailure> {
    if (unionId === undefined) return okAsync(null);

    return fromPromise(
      this.prisma.account.findFirst({
        where: {
          providerUnionId: unionId,
          user: { deletedAt: null },
        },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      }),
      (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Failed to load OAuth account by union id',
        ),
    ).map((account) => account?.user ?? null);
  }

  /**
   * 按邮箱找用户（`deletedAt: null`——已注销的不算）。
   *
   * 返回单个用户而不是列表：`users.email` 是唯一索引，且软删除行仍占用它，
   * 所以「同一邮箱多个活跃账号」在数据库层不可能。
   */
  private findUserByEmail(
    email: string | null,
  ): ResultAsync<User | null, DomainFailure> {
    if (email === null) return okAsync(null);

    return fromPromise(
      this.prisma.user.findFirst({
        where: { email, deletedAt: null },
      }),
      (error) =>
        mapUnknownToDependencyFailure(error, 'Failed to load user by email'),
    );
  }

  /** 按 id 取用户；判定已保证它存在，取不到是数据异常。 */
  private requireUser(userId: string | null): ResultAsync<User, DomainFailure> {
    if (userId === null) {
      return errAsync(
        createDomainFailure({
          kind: 'dependency',
          code: 'DEPENDENCY_UNAVAILABLE',
          detail: 'OAuth account owner disappeared between queries',
        }),
      );
    }
    return fromPromise(
      this.prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
      }),
      (error) =>
        mapUnknownToDependencyFailure(error, 'Failed to load OAuth user'),
    ).andThen((user) =>
      user === null
        ? errAsync(
            createDomainFailure({
              kind: 'dependency',
              code: 'DEPENDENCY_UNAVAILABLE',
              detail: 'OAuth account owner disappeared between queries',
            }),
          )
        : okAsync(user),
    );
  }

  // ── 写入 ─────────────────────────────────────────────────────

  private createOAuthUser(
    profile: OAuthProviderProfile,
  ): ResultAsync<User, DomainFailure> {
    // No email is fine: WeChat and other providers do not always disclose one,
    // and `users.email` is nullable for exactly this case. The account can set
    // an email later through `POST /account/email`.
    return fromPrismaResult(
      this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            ...(profile.email != null && {
              email: normalizeEmail(profile.email),
            }),
            ...(profile.nickname !== undefined && {
              nickname: profile.nickname,
            }),
            ...(profile.avatar !== undefined && { avatar: profile.avatar }),
            ...(profile.emailVerifiedAt !== undefined && {
              emailVerifiedAt: profile.emailVerifiedAt,
            }),
            profile: { create: {} },
          },
        });
        await tx.account.create({
          data: this.toAccountCreateData(user.id, profile),
        });
        return user;
      }),
    );
  }

  private createAccount(
    userId: string,
    profile: OAuthProviderProfile,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.account
        .create({
          data: this.toAccountCreateData(userId, profile),
        })
        .then(() => undefined),
    );
  }

  private toAccountCreateData(
    userId: string,
    profile: OAuthProviderProfile,
  ): Prisma.AccountCreateInput {
    const email = profile.email;
    return {
      id: randomUUID(),
      user: { connect: { id: userId } },
      issuer: profile.provider,
      providerId: profile.provider,
      accountId: profile.providerUserId,
      ...(profile.unionId !== undefined && {
        providerUnionId: profile.unionId,
      }),
      ...(email !== undefined && {
        providerEmail: email === null ? null : normalizeEmail(email),
      }),
      ...(profile.emailVerifiedAt !== undefined && {
        providerEmailVerifiedAt: profile.emailVerifiedAt,
      }),
      ...(profile.rawProfile !== undefined && {
        // **持久化关切在此处收口**：`OAuthProfile.rawProfile` 是可 JSON 序列化的
        // 普通对象（不带 ORM 类型），要不要落库、落成什么形状由这里决定。
        // 领域/应用层因此不必认识 `Prisma.InputJsonValue`。
        rawProfile: toInputJsonValue(profile.rawProfile),
      }),
    };
  }

  private identityInUse(): DomainFailure {
    return createDomainFailure({
      kind: 'conflict',
      code: 'RESOURCE_CONFLICT',
    });
  }
}
