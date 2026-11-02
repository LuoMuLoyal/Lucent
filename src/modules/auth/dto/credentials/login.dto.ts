import { z } from 'zod';
import {
  captchaTokenSchema,
  emailAddressSchema,
  strongPasswordSchema,
  verificationCodeSchema,
} from '../../../../common/validators/auth.decorators.js';

/**
 * Standard Schema (zod) for `POST /auth/login` body.
 *
 * Migration notes (class-validator → zod):
 * - `@IsEmailAddress()` → `emailAddressSchema()` (zod email format + not-empty
 *   messages reused from the original validator);
 * - `@IsStrongPassword({ optional: true })` → `strongPasswordSchema().optional()`.
 *   Login applies the same strength rules as password setup. Stored passwords
 *   that no longer score high enough are rejected rather than grandfathered in;
 *   those accounts must reset through "forgot password";
 * - `@IsVerificationCode({ optional: true })` → `verificationCodeSchema().optional()`
 *   (default: exactly `VERIFICATION_CODE_LENGTH` characters when present);
 * - `captchaTokenSchema()` 在此保持可选：是否强制由运行时决定（未配置即整体
 *   关闭；登录侧仅在失败次数越过阈值后要求），schema 不参与该判断；
 * - the global `forbidNonWhitelisted` posture is preserved with `.strict()`.
 */
export const loginSchema = z
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

/** Strongly typed body of `POST /auth/login`. */
export type LoginDto = z.infer<typeof loginSchema>;
