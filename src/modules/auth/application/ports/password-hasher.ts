/**
 * 密码哈希的出站端口 —— 应用层不接触 Argon2 库。
 *
 * ## 为什么哈希算法是端口
 *
 * 参数（`memoryCost` / `timeCost` / `parallelism`）是**安全参数**：调高会拖慢
 * 登录，调低会削弱抗爆破。它们不该散在业务流程里被顺手改。端口把「哈希一个
 * 密码」和「比对一个密码」收敛成两个动作，参数留在实现层一处。
 *
 * ## 失败语义（不变量 #2）
 *
 * 两个方法都以 Promise **拒绝**表示依赖故障，**绝不返回 `false`**。
 * 这是刻意的：`verify` 返回 `false` 的含义是「密码不对」，如果哈希库崩了也
 * 返回 `false`，调用方就会把它报成「密码错」——引导用户去重置一个没有问题的
 * 密码。故障必须走异常通道，与「不匹配」在类型上分开。
 */
import type { PasswordHash } from '../../domain/account/password-hash.js';

/** 明文密码（只在此处与投递层之间传递，绝不落库或入日志）。 */
export type PlainPassword = string;

export abstract class PasswordHasher {
  /**
   * 哈希一个明文密码。
   *
   * @throws 当哈希后端不可用时拒绝（**不**返回任何占位值）。
   */
  abstract hash(password: PlainPassword): Promise<PasswordHash>;

  /**
   * 比对明文密码与已存哈希。
   *
   * 返回 `false` **只表示密码不匹配**；哈希格式无法识别或后端故障都必须
   * 拒绝 Promise，而不是返回 `false`。
   */
  abstract verify(
    hash: PasswordHash,
    password: PlainPassword,
  ): Promise<boolean>;
}
