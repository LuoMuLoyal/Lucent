import { z } from 'zod';
import {
  emailAddressSchema,
  strongPasswordSchema,
  verificationCodeSchema,
} from '../../../../common/validators/auth.decorators.js';

/**
 * Standard Schema (zod) for `POST /auth/reset-password` body.
 *
 * Password reset uses the product-level verification code (same anti-abuse
 * mechanism as register / set-password) instead of a Better Auth email link.
 */
export const resetPasswordSchema = z
  .object({
    email: emailAddressSchema().describe('邮箱地址'),
    code: verificationCodeSchema().describe('邮箱验证码（6 位）'),
    password: strongPasswordSchema({
      messagePrefix: '新密码',
    }).describe('新密码（8-32位，需包含大小写字母和数字）'),
  })
  .strict();

/** Strongly typed body of `POST /auth/reset-password`. */
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;