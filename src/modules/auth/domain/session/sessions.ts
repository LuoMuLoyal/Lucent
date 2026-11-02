/**
 * 会话的仓储端口 —— 领域层只声明「会话要怎么被存取」，不关心 Prisma。
 *
 * ## 为什么端口里全是细动作而不是 `save(session)`
 *
 * 会话的写路径全是**条件更新**，不是对象整体落库：
 *
 * - 认领轮换必须原子（`rotatedAt IS NULL` 才写成当前时刻），否则两个并发
 *   refresh 都会成功，一次性轮换就形同虚设。
 * - 撤销整族是按 `(userId, familyId)` 批量打时间戳。
 * - 轮换掉的行走**保留为 tombstone**，不是删除——删掉就再也分不清「用过的
 *   token」与「不存在的 token」，重放检测失去信号。
 *
 * 用一个 `save(aggregate)` 建模这些动作会逼实现方猜意图，所以端口直接暴露
 * 这几种语义明确的写动作；读侧只给「按指纹查一行」与「校验归属用的按 id 查」。
 *
 * ## 依赖方向
 *
 * 本文件不 import 任何东西。`PrismaSessions`（infrastructure/persistence）实现它；
 * 应用层只依赖这个抽象类。ADR-0024 的 D1/D5 护栏负责守住这条线。
 */

/** 会话行上记录的一次请求元数据。 */
export interface SessionRequestContext {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * 建立会话所需的全部输入。
 *
 * `familyId` 的取值见 `domain/session/session.ts` 的 `SESSION_FAMILY_ROOT`：
 * 全新登录传自己的 `id`，轮换传被替换会话的 `familyId`。
 */
export interface NewSessionInput {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  lastUsedAt: Date;
  familyId: string;
  context?: SessionRequestContext;
}

/** 一次 refresh 需要的会话快照（含归属人，省掉第二次查询）。 */
export interface SessionForRefresh {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedAt: Date | null;
}

/**
 * 会话清单的一行（读侧形状，不是聚合）。
 *
 * ## 没有设备字段
 *
 * `user_sessions` 表里有 `device_type` / `device_name` / `platform` 三列，
 * 但**全仓库没有任何写入路径**——`PrismaSessions.create()` 不写，
 * `AuthRequestContext` 也只有 `ipAddress`/`userAgent`，客户端没有上传设备信息
 * 的通道。所以它们恒为 `null`。
 *
 * 2026-10-25 从契约里删掉了：恒为 null 的字段是**契约谎言**——客户端会写
 * `deviceName ?? '未知设备'` 的兜底，以为「某些情况下有值」，而实际永远不会。
 * 要真做「设备清单」得先让客户端上报设备信息，那是另一个需求。
 *
 * ## `refreshTokenHash` 用来判定「当前会话」
 *
 * access token 的 payload 里没有 session id，所以「哪条是当前会话」只能靠
 * 请求携带的 refresh token 反查。读侧因此需要这一列（**不出口**，只在
 * `SessionTokens.list` 内部用于比对）。
 */
export interface ActiveSessionRow {
  id: string;
  userId: string;
  /** 该行的 refresh token 指纹。**仅用于内部判定 `isCurrent`，不进响应。** */
  refreshTokenHash: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * 会话仓储端口。
 *
 * 所有方法返回 Promise 或 Promise 包装的缓存结果；失败语义由实现方决定
 * （应用层用 `fromPromise` 把它们抬进 Result 通道）。
 */
export abstract class Sessions {
  /**
   * 写入一条新会话行。
   *
   * 调用方必须先写行、再签 JWT（见 `SessionTokens.issue` 的注释）：反过来一旦
   * 签名失败，用户会拿到一个能用的 access token 却没有会话行，refresh 永远失败。
   */
  abstract create(input: NewSessionInput): Promise<void>;

  /** 按 refresh token 指纹取一行；查不到时返回 `null`（不是错误）。 */
  abstract findByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<SessionForRefresh | null>;

  /** 按 id 取一行；查不到时返回 `null`。 */
  abstract findById(id: string): Promise<SessionForRefresh | null>;

  /**
   * 原子认领一次轮换：仅当该行仍可用（未轮换、未吊销、未过期）时写入
   * `rotatedAt`。返回是否认领成功。
   *
   * 落败方拿到 `false`，由应用层重新读一次行并按领域判定区分「竞态」与「盗用」。
   */
  abstract claimForRefresh(id: string, at: Date): Promise<boolean>;

  /**
   * 撤销整族里所有仍有效的会话，返回撤销条数。
   *
   * 只在判定为盗用时调用：两个人都持有同一条链，必须整条终止。
   */
  abstract revokeFamily(
    userId: string,
    familyId: string,
    at: Date,
  ): Promise<number>;

  /** 吊销单条会话（存在则打时间戳；不存在也算成功，幂等）。 */
  abstract revokeById(id: string, at: Date): Promise<void>;

  /** 按 `(userId, 指纹)` 删除会话行——登出当前会话。 */
  abstract deleteByUserIdAndHash(userId: string, hash: string): Promise<void>;

  /** 删除该用户的全部会话行——改密后强制下线。 */
  abstract deleteAllForUser(userId: string): Promise<void>;

  /**
   * 该用户仍有效的会话（轮换掉的 tombstone 不算）。
   *
   * 按 `lastUsedAt` 倒序——清单的第一条通常是当前设备。
   */
  abstract listActive(userId: string): Promise<ActiveSessionRow[]>;
}
