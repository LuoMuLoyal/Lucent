import { z } from 'zod';
import { strongPasswordSchema } from '../../../../common/validators/auth.decorators.js';

/**
 * Standard Schema (zod) for `POST /auth/reset-password` body.
 *
 * Migration notes:
 * - `@IsString` + `@IsNotEmpty({ message: 'token 不能为空' })` → string with a
 *   `token 不能为空` message (base `error` covers missing/non-string values);
 * - `@IsStrongPassword({ messagePrefix: '新密码' })` →
 *   `strongPasswordSchema({ messagePrefix: '新密码' })`.
 */
export const resetPasswordSchema = z
  .object({
    token: z
      .string({ error: 'token 不能为空' })
      .min(1, 'token 不能为空')
      .describe('Better Auth 密码重置 token'),
    password: strongPasswordSchema({
      messagePrefix: '新密码',
    }).describe('新密码（8-32位，需包含大小写字母和数字）'),
  })
  .strict();

/** Strongly typed body of `POST /auth/reset-password`. */
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
