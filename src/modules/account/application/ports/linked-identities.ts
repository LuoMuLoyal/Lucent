/**
 * 已链接身份的仓储端口 —— `account` 上下文不直连 Prisma。
 *
 * ## 为什么这个端点归 account 而不是 auth
 *
 * `user_sessions` / `user` 属于 auth 与 user 上下文，但**「这个账户关联了哪些
 * 登录方式」是账户档案的一部分**——它和 nickname/avatar 一起构成
 * `GET /account` 的响应。所以读写它的是 account 上下文，不是 auth。
 *
 * `CREDENTIAL_PROVIDER_ID` 过滤仍走 auth 的常量（那是「哪些 provider 算凭据」
 * 的唯一事实源），但查询本身在本上下文。
 */

/** 一条已链接的第三方身份（读侧形状）。 */
export interface LinkedIdentityRow {
  id: string;
  providerId: string;
  providerEmail: string | null;
  providerEmailVerifiedAt: Date | null;
  createdAt: Date;
}

export abstract class LinkedIdentities {
  /** 该用户的第三方身份（不含凭据行），按创建时间升序。 */
  abstract listForUser(userId: string): Promise<LinkedIdentityRow[]>;

  /** 该用户是否还有其他第三方身份（事务内重查，用于防 TOCTOU）。 */
  abstract listForUserInTransaction(
    scope: TransactionScope,
    userId: string,
  ): Promise<LinkedIdentityRow[]>;

  /**
   * 在一个事务里解绑身份。
   *
   * ## 为什么整个「重查 + 删除」必须在一个端口方法里
   *
   * 调用方要先重查 `hasPassword` 与剩余身份数，再决定是否允许删除——
   * 这两步之间若不加事务，就会出现 TOCTOU 窗口：并发事务可能刚刚加了凭据
   * （用户设置密码成功）或删了最后一个社交身份。
   *
   * 端口让实现者负责事务边界，用例只表达**规则**（`keepAtLeastOne`）。
   * 违反规则时以 `IdentityUnlinkRejected` 抛出，由用例映射成
   * `RESOURCE_NOT_FOUND` / `FORBIDDEN`。
   */
  abstract unlinkInTransaction(input: {
    userId: string;
    identityId: string;
    /** 事务内重查「是否已有密码」的回调（跨上下文读，见下方说明）。 */
    hasPassword: (scope: TransactionScope) => Promise<boolean>;
  }): Promise<void>;
}

/**
 * 事务作用域 —— 传给需要「在同一事务里读」的回调。
 *
 * 用 `object` 而不是具名 interface：具体类型是实现的私事，用例只需要把不透明
 * 句柄原样传回去。
 */
export type TransactionScope = object;

/**
 * 解绑被规则拒绝。
 *
 * 用异常而不是 Result：它在**事务内部**抛出，需要让事务回滚；端口返回
 * `Promise<void>` 的约定是「失败即抛出」。
 */
export class IdentityUnlinkRejected extends Error {
  constructor(readonly reason: 'not-found' | 'last-identity') {
    super(`Identity unlink rejected: ${reason}`);
    this.name = 'IdentityUnlinkRejected';
  }
}
