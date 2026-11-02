/**
 * 会话寿命的出站端口 —— 「access token 活多久、refresh token 活多久」。
 *
 * ## 为什么这算端口
 *
 * TTL 有两个来源：环境变量基线（启动时读）与运行期快照（可以在线发布）。
 * 应用层不该知道哪一层覆盖了哪一层，也不该碰 `ConfigService`；它只问
 * 「现在签出去的 token 应该活多久」。
 *
 * ## 解析是每次签发都做的
 *
 * 端口方法在每次签发/轮换时被调用一次，不是构造时缓存：新发布的 TTL 必须
 * 作用于之后签出的 token，而已签出的 token 保留 `exp` 里的旧值。
 */
export abstract class SessionLifetime {
  /**
   * 当前的 TTL（秒）。
   *
   * 返回秒而不是毫秒：JWT 库与投递层的 `Max-Age` 都用秒，两处换算一次就够了。
   */
  abstract resolve(): { accessTtlSeconds: number; refreshTtlSeconds: number };
}
