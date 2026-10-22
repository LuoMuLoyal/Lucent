import { z } from 'zod';
import {
  captchaTokenSchema,
  emailAddressSchema,
  strongPasswordSchema,
  verificationCodeSchema,
} from '../../../../common/validators/auth.decorators.js';

/**
 * Standard Schema (zod) for `POST /auth/session/login`.
 *
 * **字段与 `loginSchema` 完全相同**——这是刻意保持的：两条路（Bearer 与 cookie）
 * 走的是同一套凭据校验，差别只在响应形态与 token 的存放位置。
 * 分成两个 schema 而不是复用同一个，是因为两者的**语义承诺不同**：
 * 这个端点承诺「不返回 token」，将来若要分别演进，不至于误改另一端。
 *
 * `password` 与 `code` 二选一：两者都缺时服务端按统一的凭据失败处理
 * （反枚举，与「密码错」不可区分），所以 schema 层不做「至少给一个」的约束——
 * 那会把「没填」和「填错」区分开，反而泄露信息。
 */
export const sessionLoginSchema = z
  .object({
    email: emailAddressSchema().describe('邮箱地址'),
    password: strongPasswordSchema()
      .describe('密码（与验证码二选一）')
      .optional(),
    code: verificationCodeSchema()
      .describe('邮箱验证码（与密码二选一）')
      .optional(),
    captchaToken: captchaTokenSchema().describe('人机验证令牌'),
  })
  .strict();

/** Strongly typed body of `POST /auth/session/login`. */
export type SessionLoginDto = z.infer<typeof sessionLoginSchema>;

/**
 * Standard Schema (zod) for `POST /auth/session/register`.
 *
 * 与 `registerSchema` 字段一致，理由同上。注册**必须**带邮箱验证码。
 */
export const sessionRegisterSchema = z
  .object({
    email: emailAddressSchema().describe('邮箱地址'),
    password:
      strongPasswordSchema().describe('密码（至少8位，需通过强度校验）'),
    code: verificationCodeSchema({ exactLength: false }).describe('邮箱验证码'),
    captchaToken: captchaTokenSchema().describe('人机验证令牌'),
    nickname: z
      .string()
      .min(1, 'validation.field.required')
      .max(20, 'validation.field.too_long')
      .describe('昵称')
      .optional(),
  })
  .strict();

/** Strongly typed body of `POST /auth/session/register`. */
export type SessionRegisterDto = z.infer<typeof sessionRegisterSchema>;
