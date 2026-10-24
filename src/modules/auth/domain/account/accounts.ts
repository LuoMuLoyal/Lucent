/**
 * 本地凭据账号的仓储端口 —— 身份层对 `accounts` / `users` 两表的写侧。
 *
 * ## 为什么这个端口比 `Sessions` 更「宽」
 *
 * 会话聚合只碰一张表；本地凭据的注册要在**一个事务里**写 `users` + `accounts`
 * 两行（新用户必须同时有身份行，否则会出现「能登录但没有身份」的半成品）。
 * 所以端口暴露的是**两个语义完整的操作**，而不是一堆裸 CRUD：
 *
 * - `createLocalAccount` —— 建号，含「邮箱已存在则返回既有行」的语义
 *   （注册的反枚举依赖它：不区分「刚建好」与「早就存在」）。
 * - `replacePassword` —— 设/改/重置密码的**唯一写入口**。
 *
 * 这两个操作的共同点是：它们各自是一个**原子承诺**，不是可以拆开做一半的
 * 步骤。这正是 ADR-0024「一个事务只改一个聚合」在端口形状上的体现。
 *
 * ## 依赖方向
 *
 * 只 import 同层的值对象与 `TransactionScope`。不 import Prisma、不 import
 * `common/result`（错误由实现抛出、应用层映射）。
 */
import type { StoredPassword } from '../../domain/account/password-hash.js';
import type { TransactionScope } from './transaction-scope.js';

/** 本地凭据账号（`providerId = 'credential'` 那一行）。 */
export interface LocalCredentialAccount {
  /** 归属用户 id。本地凭据身份里它同时是 `accountId`（一个用户至多一条）。 */
  userId: string;
  /** 邮箱。OAuth-only 账号可能为 `null`。 */
  email: string | null;
  /** 账户状态（原样字符串，由领域层收敛）。 */
  status: string;
  /** 已存密码。`none` 表示没有本地密码。 */
  password: StoredPassword;
}

/** 建号的结果。 */
export interface CreateLocalAccountResult {
  userId: string;
  /**
   * `true` = 本次调用新建了用户；`false` = 该邮箱早已存在，返回既有用户。
   *
   * **调用方必须用同一个响应处理两者**（反枚举）：注册时邮箱已占用与验证码
   * 错误对外同码。把这个布尔暴露出来是为了让调用方能**显式**做这个决定，
   * 而不是让它悄悄消失。
   */
  created: boolean;
}

/**
 * 本地凭据的仓储端口。
 */
export abstract class Accounts {
  /**
   * 按邮箱查账号。查不到返回 `null`（不是错误）。
   *
   * 返回的 `password` 是**已存哈希的编码串**，供领域层判定用；
   * 明文密码永远不经过这里。
   */
  abstract findByEmail(email: string): Promise<LocalCredentialAccount | null>;

  /** 按用户 id 查账号（设备/会话之外的账号自助路径用）。 */
  abstract findByUserId(userId: string): Promise<LocalCredentialAccount | null>;

  /**
   * 建本地凭据账号（`users` + `accounts` 两行，同一事务）。
   *
   * 邮箱已存在时**不报错**，返回 `{ created: false }` 与既有 userId——
   * 报错会让注册接口出现「邮箱已占用」这种可枚举的差异。
   */
  abstract createLocalAccount(input: {
    email: string;
    passwordHash: string;
    nickname?: string;
  }): Promise<CreateLocalAccountResult>;

  /**
   * 写入/替换该用户的密码哈希（设密码、改密码、重置密码共用）。
   *
   * `upsert` 语义：本地凭据行不存在时创建（OAuth-only 账号第一次设密码）。
   */
  abstract replacePassword(
    userId: string,
    passwordHash: string,
    tx?: TransactionScope,
  ): Promise<void>;

  /**
   * 该用户是否有本地密码。
   *
   * 单独一个方法而不是「查账号再看 password 是否为 null」：`account` 模块
   * 在自己的事务里需要它（TOCTOU 复检），而那时不能走 `findByUserId`
   * 之外的读路径。
   */
  abstract hasPassword(userId: string, tx?: TransactionScope): Promise<boolean>;

  /** 软删除用户（删号）。 */
  abstract softDeleteUser(userId: string, deletedAt: Date): Promise<void>;

  /** 标记邮箱已验证。 */
  abstract markEmailVerified(userId: string, at: Date): Promise<void>;
}
