/**
 * 验证码本身 —— 生成、派生指纹、比对。全部是纯函数。
 *
 * ## 三条规则，每条都是安全性质
 *
 * 1. **验证码与「场景 + 邮箱」绑定**。指纹是 `sha256(scene:email:code)`，
 *    不是 `sha256(code)`。这直接决定：为 `register` 签发的码**不能**用于
 *    `login`，也不能用于另一个邮箱。若指纹只含码本身，一个 6 位数字的哈希空间
 *    只有 10^6——拿到存储指纹就能离线枚举出码，而且跨场景通用。
 * 2. **比对是定时的**（`timingSafeEqual`）。逐字符短路比较会把「前几位对了」
 *    这个信息通过响应时间漏出去，让暴力搜索从 10^6 降到 6×10。
 * 3. **生成用密码学随机源**（`randomInt`），不是 `Math.random()`。
 *    `Math.random` 的输出可从少量样本预测，等于验证码可预测。
 *
 * ## 领域纯度
 *
 * 只 import `node:crypto` 的纯计算函数（与 `domain/session/refresh-token.ts`
 * 同一先例）：摘要算法与随机源是**规则本身**的一部分，藏到 infrastructure 会让
 * 「怎么比对」离开不变量的所在地。
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * 验证码的位数下限与上限。
 *
 * 下限 4：3 位只有 1000 种，配合有限的尝试窗口不足以抵抗暴力。
 * 上限 10：超过之后人无法准确抄写，而安全增益远小于「用户抄错」的代价。
 */
export const MIN_CODE_LENGTH = 4;
export const MAX_CODE_LENGTH = 10;

/**
 * 十进制基数。`10 ** digits` 是位数 → 取值空间大小（6 位 → 10^6）。
 */
const DECIMAL_RADIX = 10;

/**
 * 生成一个指定位数的十进制验证码。
 *
 * @param length 位数，会被夹到 [{@link MIN_CODE_LENGTH}, {@link MAX_CODE_LENGTH}]。
 *
 * 用 `randomInt` 而不是 `Math.random()`：后者的内部状态可从少量输出推断，
 * 预测出下一个验证码就等于绕过验证。
 */
export function generateCode(length: number): string {
  const digits = clampCodeLength(length);
  const upperBound = DECIMAL_RADIX ** digits;
  // `randomInt` 的上界是开区间，且它内部做拒绝采样，不会引入模偏差。
  return randomInt(0, upperBound).toString().padStart(digits, '0');
}

/** 把配置里的位数夹进合法范围。配置错误不该让验证码退化成可预测的值。 */
export function clampCodeLength(length: number): number {
  if (!Number.isFinite(length)) return MIN_CODE_LENGTH;
  const truncated = Math.trunc(length);
  if (truncated < MIN_CODE_LENGTH) return MIN_CODE_LENGTH;
  if (truncated > MAX_CODE_LENGTH) return MAX_CODE_LENGTH;
  return truncated;
}

/**
 * 验证码 → 存储指纹。
 *
 * **场景与邮箱参与派生**，所以指纹天然绑定到「为谁、为什么场景签发」：
 * 一个码在别处用不了，且拿到指纹也无法跨场景复用。见文件头第 1 条。
 */
export function deriveCodeHash(
  code: string,
  scene: string,
  email: string,
): string {
  return createHash('sha256').update(`${scene}:${email}:${code}`).digest('hex');
}

/**
 * 定时安全的指纹比对。
 *
 * 长度不同直接返回 `false`——长度本身不是秘密（sha256 十六进制恒为 64 字符），
 * 且 `timingSafeEqual` 对不等长入参会抛异常。
 */
export function codeHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
