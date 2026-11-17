/**
 * 邮箱地址 —— 值对象。
 *
 * ## 为什么「怎么算同一个邮箱」是领域知识
 *
 * 身份层的每一条判断都建立在「这两个字符串是不是同一个账号」上：登录查账号、
 * 注册判重、改邮箱查冲突、OAuth 按邮箱自动关联。如果各处自己 `trim().toLowerCase()`，
 * 就迟早出现「注册时存了 `A@b.com`、登录时查 `a@b.com` 查不到」这类故障——
 * 而且只在混合大小写时复现。
 *
 * 所以规范化只在这里定义一次。`common` 里那个同名的通用 helper 服务于 auth
 * 之外的地方；身份层一律用本文件，避免两套规则各自演进。
 *
 * ## 领域纯度
 *
 * 不 import 任何东西。规范化是纯字符串变换。
 */

/**
 * 邮箱的**规范形式**：去掉首尾空白并转小写。
 *
 * 刻意不做更激进的归一（不去点、不拆 `+` 后缀）：那些是特定提供商（Gmail）
 * 的语义，套到所有地址上会把两个真实不同的账号合并成一个。
 */
export function canonicalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * 是否是一个「可用于身份流程」的邮箱形状。
 *
 * 这是**形状检查**，不是 RFC 5322 完整校验：完整校验既做不到（规范允许的
 * 形式极其宽泛）也不该做（真正证明地址有效的是验证码）。这里的目的是拦住
 * 明显不是地址的输入，以及避免把 `@` 前后的空段写进库。
 */
export function isEmailShaped(email: string): boolean {
  const canonical = canonicalizeEmail(email);
  const at = canonical.indexOf('@');
  if (at <= 0) return false;
  if (at !== canonical.lastIndexOf('@')) return false;
  const local = canonical.slice(0, at);
  const domain = canonical.slice(at + 1);
  if (domain.length === 0) return false;
  if (!domain.includes('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  return local.length > 0;
}
