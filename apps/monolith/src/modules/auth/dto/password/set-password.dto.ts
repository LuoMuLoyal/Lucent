import { z } from 'zod';
import {
  strongPasswordSchema,
  verificationCodeSchema,
} from '../../../../common/validators/auth.decorators.js';

/**
 * Standard Schema (zod) for `POST /account/set-password` body.
 *
 * Migration notes:
 * - `@IsVerificationCode({ exactLength: false })` →
 *   `verificationCodeSchema({ exactLength: false })` (any non-empty string);
 * - `@IsStrongPassword({ notEmptyMessage: '新密码不能为空' })` →
 *   `strongPasswordSchema({ notEmptyMessage: '新密码不能为空' })`.
 */
export const setPasswordSchema = z
  .object({
    code: verificationCodeSchema({ exactLength: false }).describe(
      '发往邮箱的验证码',
    ),
    password: strongPasswordSchema({
      notEmptyMessage: '新密码不能为空',
    }).describe('新密码（8-32位，需包含大小写字母和数字）'),
  })
  .strict();

/** Strongly typed body of `POST /account/set-password`. */
export type SetPasswordDto = z.infer<typeof setPasswordSchema>;
