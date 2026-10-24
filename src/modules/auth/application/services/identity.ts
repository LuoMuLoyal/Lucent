import { Injectable } from '@nestjs/common';

import {
  createDomainFailure,
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { Accounts } from '../../domain/account/accounts.js';
import type { StoredPassword } from '../../domain/account/password-hash.js';
import type { TransactionScope } from '../../domain/account/transaction-scope.js';
import { PasswordHasher } from '../ports/password-hasher.js';

/** 「有没有密码 + 密码是否匹配」两个事实（一次查库 + 至多一次比对）。 */
export interface LocalPasswordCheck {
  hasPassword: boolean;
  /** `null` = 没有密码，未执行比对。 */
  passwordMatches: boolean | null;
}

/**
 * 本地凭据账号的**应用服务** —— 对 `Accounts` + `PasswordHasher` 两个端口的薄编排。
 *
 * ## 它为什么还存在（而不是让调用方直接用端口）
 *
 * 它有两个消费者在**本模块之外**：`account` 模块经 barrel 注入它，在自己的
 * Prisma 事务里调 `hasPassword(userId, tx)` 做 TOCTOU 复检。`AuthIdentityService`
 * 这个名字是 barrel 的既有公开面，**保持它的签名让 `account` 一行不用改**。
 *
 * 所以它是「模块对外的一扇窄门」，不是遗留的胖服务：实现细节全部下沉了——
 * Prisma 在 `infrastructure/persistence/accounts.ts`，Argon2 在
 * `infrastructure/crypto/argon2.ts`，策略在 `domain/account/`。本类不含判断。
 *
 * ## 为什么这里保留 `ResultAsync` 而端口是 Promise
 *
 * 端口返回 Promise（领域/应用层不 import `common/result`，领域层更是禁止），
 * 失败以异常抛出。本类把异常**抬进 Result 通道**并映射成 `DomainFailure`，
 * 于是既有调用点的 `.map()` / `.andThen()` 链完全不受影响。
 * 这是「端口用异常、用例用 Result」这条分界的具体落点。
 *
 * ## 与 `domain/account/credential-verdict.ts` 的分工
 *
 * 这里**不做**凭据判定。判定需要四个事实（账号是否存在 / 有无密码 / 比对结果 /
 * 依赖是否故障），由 `CredentialAuthService` 收集后交给纯函数
 * `decideCredential`。本类只提供**取事实**与**写凭据**的动作。
 */
@Injectable()
export class AuthIdentityService {
  constructor(
    private readonly accounts: Accounts,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  // ── 密码哈希 ─────────────────────────────────────────────────

  /**
   * 哈希一个明文密码。
   *
   * 返回 Promise（不是 Result）是**既有契约**：调用方一律用
   * `fromPromise(..., mapUnknownToDependencyFailure)` 自己抬进 Result 通道，
   * 所以失败必须保持异常形态。哈希后端不可用时**绝不**返回占位值。
   */
  async hashPassword(password: string): Promise<string> {
    const hash = await this.passwordHasher.hash(password);
    return hash.encoded;
  }

  /** 比对明文与已存哈希。只表示匹配与否；后端故障以异常抛出。 */
  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return await this.passwordHasher.verify({ encoded: hash }, password);
  }

  // ── 凭据账号 ─────────────────────────────────────────────────

  /**
   * 写入/替换该用户的本地密码。设密码、改密码、重置密码共用这一个入口。
   *
   * 端口故障映射为 `DEPENDENCY_UNAVAILABLE`（**不变量 #2**）：写不进去是依赖
   * 问题，绝不能被上层说成「密码不对」。
   */
  upsertCredentialAccount(
    userId: string,
    passwordHash: string,
    tx?: TransactionScope,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(
      this.accounts.replacePassword(userId, passwordHash, tx),
      (error) =>
        mapUnknownToDependencyFailure(error, 'Failed to store credential'),
    );
  }

  /**
   * 该用户有没有本地密码。**「有没有密码」的唯一事实来源**。
   */
  hasPassword(
    userId: string,
    tx?: TransactionScope,
  ): ResultAsync<boolean, DomainFailure> {
    return fromPromise(this.accounts.hasPassword(userId, tx), (error) =>
      mapUnknownToDependencyFailure(
        error,
        'Failed to check credential account',
      ),
    );
  }

  /**
   * 建本地凭据账号。
   *
   * 邮箱已存在时返回 `{ created: false }` 与既有 userId，**不报错**——
   * 注册接口若在这里出现「邮箱已占用」的差异就成了枚举出口（反枚举）。
   */
  createLocalUser(input: {
    email: string;
    passwordHash: string;
    nickname?: string;
  }): ResultAsync<{ user: { id: string }; created: boolean }, DomainFailure> {
    return fromPromise(this.accounts.createLocalAccount(input), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to create local user'),
    ).map((result) => ({
      user: { id: result.userId },
      created: result.created,
    }));
  }

  // ── 读取事实 ─────────────────────────────────────────────────

  /**
   * 按邮箱取本地凭据账号（含已存密码）。
   *
   * 返回 `null` 表示邮箱未知。**调用方不得把「未知」与「密码不匹配」在响应上
   * 区分**（反枚举）——判定交给 `decideCredential`。
   */
  findByEmail(
    email: string,
  ): ResultAsync<
    {
      userId: string;
      email: string | null;
      status: string;
      password: StoredPassword;
    } | null,
    DomainFailure
  > {
    return fromPromise(this.accounts.findByEmail(email), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to load account by email'),
    );
  }

  /**
   * 取「有没有密码 + 密码是否匹配」两个事实，供纯函数判定使用。
   *
   * 一次查库 + 至多一次比对。**没有密码时不比对**——比对一个不存在的哈希没有
   * 意义，而返回 `false` 会让「无密码」和「密码错」在调用方看起来一样，
   * 那正是反枚举要防的混淆（这里用 `passwordMatches: null` 显式区分）。
   */
  checkLocalPassword(
    userId: string,
    password: string,
  ): ResultAsync<LocalPasswordCheck, DomainFailure> {
    return fromPromise(this.accounts.findByUserId(userId), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to load credential account'),
    ).andThen((account) => {
      if (account === null || account.password.kind !== 'set') {
        return okAsync<LocalPasswordCheck>({
          hasPassword: false,
          passwordMatches: null,
        });
      }

      return fromPromise(
        this.passwordHasher.verify(account.password.hash, password),
        (error) =>
          mapUnknownToDependencyFailure(error, 'Password verification failed'),
      ).map((matches) => ({ hasPassword: true, passwordMatches: matches }));
    });
  }

  /**
   * 按邮箱查账号并比对密码。
   *
   * 保留是为了兼容既有调用点；**新代码请用 `findByEmail`/`checkLocalPassword`
   * + 纯函数判定**——那样「多种失败折成一个结论」才有单测保证。
   * 本方法把 `null` 与 `false` 都收敛成 `null`（调用方仍不可区分）。
   */
  authenticateByEmail(
    email: string,
    password: string,
  ): ResultAsync<{ id: string } | null, DomainFailure> {
    return this.findByEmail(email).andThen((account) => {
      if (account === null || account.password.kind !== 'set') {
        return okAsync<{ id: string } | null>(null);
      }
      return fromPromise(
        this.passwordHasher.verify(account.password.hash, password),
        (error) =>
          mapUnknownToDependencyFailure(error, 'Password verification failed'),
      ).map((matches) => (matches ? { id: account.userId } : null));
    });
  }

  /**
   * 为**已认证用户**比对密码 —— 敏感操作前的重验（删号、导出数据）。
   *
   * 与登录路径的关键区别：调用方**已经知道这个人是谁**，所以这里没有枚举风险，
   * 不需要折叠——没有密码就是 `AUTH_PASSWORD_NOT_SET`（提示去设密码），
   * 密码错就是 `false`（由 `PasswordReauthService` 映射成 `AUTH_WRONG_PASSWORD`）。
   *
   * 把这两种情形与登录路径分开，是因为**折叠只在有枚举风险的地方才是必需的**；
   * 到处折叠会让「请先去设置密码」这类有用的提示消失。
   */
  verifyPasswordForUser(
    userId: string,
    password: string,
  ): ResultAsync<boolean, DomainFailure> {
    return this.findByUserId(userId).andThen((account) => {
      if (account === null || account.password.kind !== 'set') {
        return errAsync(this.passwordNotSetFailure());
      }
      return fromPromise(
        this.passwordHasher.verify(account.password.hash, password),
        (error) =>
          mapUnknownToDependencyFailure(error, 'Password verification failed'),
      );
    });
  }

  /**
   * 按用户 id 查账号。
   *
   * 与 {@link findByEmail} 分开而不是共用一个「按条件查」：两者的调用点关心
   * 的事实不同（前者是登录、后者是账号自助），合成一个会让「谁在读密码」
   * 变模糊。
   */
  findByUserId(
    userId: string,
  ): ResultAsync<
    {
      userId: string;
      email: string | null;
      status: string;
      password: StoredPassword;
    } | null,
    DomainFailure
  > {
    return fromPromise(this.accounts.findByUserId(userId), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to load account by user id'),
    );
  }

  /** 该用户没有本地密码时的领域失败（供既有调用点保持行为）。 */
  passwordNotSetFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'authentication',
      code: 'AUTH_PASSWORD_NOT_SET',
    });
  }
}
