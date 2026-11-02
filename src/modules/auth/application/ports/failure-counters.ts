/**
 * 失败计数的出站端口 —— 限流与人机验证的**存储抽象**。
 *
 * ## 为什么是端口
 *
 * 限流的状态存在缓存里（Redis 或内存），而「桶怎么转移」是策略
 * （`domain/policies/login-failures.ts`）。端口只描述「怎么读写一个计数器」，
 * 不描述阈值与窗口。
 *
 * ## 为什么是「按 key 的通用计数器」而不是「登录失败桶专用方法」
 *
 * 两条路径共用同一套机制，只是 key 不同：
 * - 登录失败：按邮箱（`auth:login-failure:<sha256(email)>`）
 * - 密码重验失败：按 userId（`auth:reauth-failure:<userId>`）
 *
 * 端口因此只暴露 `read(key)` / `write(key, value, ttlMs)` / `clear(key)`，
 * 由应用层决定 key 与阈值。这样加一条新的限流路径不需要改端口。
 *
 * ## 失败语义（不变量 #2）
 *
 * 三个方法都以 Promise **拒绝**表示缓存故障，**绝不返回空值或默认桶**。
 * 返回「没有桶」的含义是「没有失败记录」，如果把缓存宕机也说成「没有记录」，
 * 限流就静默失效了——那是把依赖故障伪装成正常状态。
 */
export abstract class FailureCounters {
  /**
   * 读取一个计数器。不存在返回 `null`（不是错误）。
   *
   * @throws 缓存不可用时拒绝。
   */
  abstract read(key: string): Promise<unknown>;

  /**
   * 写入一个计数器并设置 TTL。
   *
   * @throws 缓存不可用时拒绝。
   */
  abstract write(key: string, value: unknown, ttlMs: number): Promise<void>;

  /**
   * 删除一个计数器（登录成功、验证通过后清零）。
   *
   * @throws 缓存不可用时拒绝。
   */
  abstract clear(key: string): Promise<void>;
}
