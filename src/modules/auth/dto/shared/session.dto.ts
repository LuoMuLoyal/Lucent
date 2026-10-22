import { z } from 'zod';

/**
 * Response schema of the **cookie session** endpoints
 * (`/auth/session/*`, `/auth/me`).
 *
 * ## 为什么与 Bearer 那条路的响应不同
 *
 * 手机端（Luminous）拿的是 `{ user, tokens }`，token 由客户端自己保管。
 * 桌面/网页端（Lumine，同构项目）走的是 httpOnly cookie：**浏览器脚本读不到
 * token**，因此响应里**不含** `tokens`，只回用户资料与「访问令牌多久过期」。
 *
 * 这不是同一个契约的两种包法，而是一次刻意的安全取舍：
 * token 不出现在任何 JS 可读的位置。
 */

/** 会话用户资料。字段与 `UserFullDto` 对齐，但**不含** token。 */
export const sessionUserSchema = z.object({
  id: z.string().describe('用户 ID'),
  email: z.string().describe('邮箱地址'),
  nickname: z.string().nullable().describe('昵称'),
  avatar: z.string().nullable().describe('头像 URL'),
  emailVerified: z.boolean().describe('邮箱是否已验证'),
  emailVerifiedAt: z.string().nullable().describe('邮箱验证时间 (ISO 8601)'),
  createdAt: z.string().describe('创建时间 (ISO 8601)'),
  updatedAt: z.string().describe('更新时间 (ISO 8601)'),
});

/** Strongly typed session user block. */
export type SessionUserDto = z.infer<typeof sessionUserSchema>;

/**
 * 会话建立 / 刷新的响应。
 *
 * `expiresIn` 让前端知道**何时该静默刷新**（access token 的剩余秒数），
 * 而 cookie 本身的有效期由服务端 `Max-Age` 控制。
 */
export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  expiresIn: z
    .number()
    .describe('访问令牌过期时间（秒）')
    .meta({ example: 900 }),
});

/** Strongly typed session response body. */
export type SessionResponseDto = z.infer<typeof sessionResponseSchema>;
