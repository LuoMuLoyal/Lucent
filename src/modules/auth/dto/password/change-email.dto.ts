import { z } from 'zod';
import {
  emailAddressSchema,
  verificationCodeSchema,
} from '../../../../common/validators/auth.decorators.js';

/**
 * Standard Schema (zod) for `POST /account/email` body.
 *
 * Migration notes:
 * - `@IsEmailAddress({ notEmptyMessage: '新邮箱不能为空' })` →
 *   `emailAddressSchema({ notEmptyMessage: '新邮箱不能为空' })`;
 * - `@IsVerificationCode()` → `verificationCodeSchema()` (exactly
 *   `VERIFICATION_CODE_LENGTH` characters);
 * - current password is a plain non-empty string (not a strong password).
 */
export const changeEmailSchema = z
  .object({
    newEmail: emailAddressSchema({
      notEmptyMessage: '新邮箱不能为空',
    }).describe('新邮箱'),
    code: verificationCodeSchema().describe('验证码'),
    password: z
      .string({ error: '当前密码不能为空' })
      .min(1, '当前密码不能为空')
      .describe('当前密码（敏感操作再认证用）'),
  })
  .strict();

/** Strongly typed body of `POST /account/email`. */
export type ChangeEmailDto = z.infer<typeof changeEmailSchema>;
