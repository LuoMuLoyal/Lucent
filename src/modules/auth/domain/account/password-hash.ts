/**
 * 密码哈希 —— 值对象与「怎么比对」的领域知识。
 *
 * ## 为什么哈希是领域概念而不是基础设施细节
 *
 * 「密码怎么存」看起来像 IO，但这里的每条规则都是**不变量**：
 *
 * - **永不存明文**：库里只有 Argon2 编码串。领域层因此不可能「顺手比一下明文」。
 * - **未知算法一律拒绝**：`verify` 只接受 Argon2 的编码前缀。把无法识别的哈希
 *   当成「比对失败」会把格式错误伪装成密码错误——那正是反枚举桶最不该装的东西。
 * - **无哈希 ≠ 密码错**：`password-hash.ts` 用一个显式的 `none` 表示「这个账号
 *   没有本地密码」，让调用方必须为它做一个决定，而不是让 `null` 悄悄流过。
 *
 * 具体的 Argon2 调用在 `infrastructure/crypto/`；本文件只声明「什么算合法的
 * 存储形式」与「缺密码怎么表达」。
 *
 * ## 领域纯度
 *
 * 不 import 任何东西。编码串是字符串，算法识别靠前缀字符串比较。
 */

/**
 * Argon2 编码哈希的前缀。
 *
 * Argon2 的编码形式是 `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`，
 * 因此所有合法哈希都以 `$argon2` 开头。用前缀而不是正则，是因为我们只需要
 * 区分「是不是 Argon2 系」，不需要在这里校验参数——参数由实现层决定，
 * 而且历史参数不同的哈希仍然必须能验证。
 */
const ARGON2_PREFIX = '$argon2';

/** 一个已存的密码哈希。 */
export interface PasswordHash {
  /** Argon2 编码串。**构造后不可变**——没有「改一个字符」的合法场景。 */
  readonly encoded: string;
}

/**
 * 密码存在性 —— 三态而不是布尔。
 *
 * 把「没有本地密码」（OAuth-only 账号）与「有密码」分开表达，是为了让
 * **登录判定必须显式处理它**：`null` 太容易被 `if (!hash)` 顺手折进
 * 「密码错」，而这两件事对用户的含义完全不同（一个是「去设密码」，
 * 一个是「密码输错了」）——尽管它们**对外必须是同一个响应**（反枚举）。
 *
 * 类型上区分、响应上统一，这是本模块反复出现的形状。
 */
export type StoredPassword =
  | { kind: 'set'; hash: PasswordHash }
  | { kind: 'none' };

/**
 * 把库里读出的字符串收敛成 {@link StoredPassword}。
 *
 * 空串与 `null`/`undefined` 都算 `none`：`accounts.password` 是可空列，
 * 但历史上也写进过空串，两者语义相同。
 */
export function toStoredPassword(
  encoded: string | null | undefined,
): StoredPassword {
  if (encoded == null || encoded.length === 0) {
    return { kind: 'none' };
  }
  return { kind: 'set', hash: { encoded } };
}

/**
 * 这个哈希是不是本系统能验证的形式。
 *
 * 只认 Argon2 前缀。**未知形式必须被拒绝而不是当作不匹配**：如果返回
 * 「不匹配」，一个被写坏的哈希会表现成「用户密码错了」，用户会去重置一个
 * 本来没问题的密码——那正是「依赖/数据故障不得折进反枚举桶」要防的事。
 */
export function isVerifiableHash(hash: PasswordHash): boolean {
  return hash.encoded.startsWith(ARGON2_PREFIX);
}
