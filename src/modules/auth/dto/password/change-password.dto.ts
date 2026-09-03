import { z } from 'zod';
import { strongPasswordSchema } from '../../../../common/validators/auth.decorators.js';

/**
 * Standard Schema (zod) for `POST /account/password` body.
 *
 * Migration notes:
 * - current password is a plain non-empty string (not a strong password);
 * - `@IsStrongPassword({ notEmptyMessage: '新密码不能为空' })` →
 *   `strongPasswordSchema({ notEmptyMessage: '新密码不能为空' })`.
 */
export const changePasswordSchema = z
  .object({
    password: z
      .string({ error: '当前密码不能为空' })
      .min(1, '当前密码不能为空')
      .describe('当前密码（敏感操作再认证用）'),
    newPassword: strongPasswordSchema({
      notEmptyMessage: '新密码不能为空',
    }).describe('新密码（8-32位，需包含大小写字母和数字）'),
  })
  .strict();

/** Strongly typed body of `POST /account/password`. */
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
