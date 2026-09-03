import { z } from 'zod';
import {
  emailAddressSchema,
  strongPasswordSchema,
  verificationCodeSchema,
} from '../../../../common/validators/auth.decorators.js';

/**
 * Standard Schema (zod) for `POST /auth/register` body.
 *
 * Migration notes:
 * - `@IsEmailAddress()` → `emailAddressSchema()`;
 * - `@IsStrongPassword()` → `strongPasswordSchema()` (default 密码 prefix);
 * - `@IsVerificationCode({ exactLength: false })` →
 *   `verificationCodeSchema({ exactLength: false })` (any non-empty string;
 *   the exact-length check is disabled for registration);
 * - nickname: `@IsOptional` `@IsString` `@MinLength(1)` `@MaxLength(20)` →
 *   `z.string().min(1, …).max(20, …).optional()`.
 */
export const registerSchema = z
  .object({
    email: emailAddressSchema().describe('邮箱地址'),
    password: strongPasswordSchema().describe(
      '密码（8-32位，需包含大小写字母和数字）',
    ),
    code: verificationCodeSchema({ exactLength: false }).describe('邮箱验证码'),
    nickname: z
      .string()
      .min(1, '昵称至少 1 个字符')
      .max(20, '昵称最多 20 个字符')
      .describe('昵称')
      .optional(),
  })
  .strict();

/** Strongly typed body of `POST /auth/register`. */
export type RegisterDto = z.infer<typeof registerSchema>;
