import { z } from 'zod';
import { verificationCodeSchema } from '../../../../common/validators/auth.decorators.js';

/**
 * Standard Schema (zod) for `DELETE /account` body.
 *
 * Migration notes:
 * - `@IsOptional` + `@IsString` + `@IsNotEmpty({ message: '密码不能为空' })` →
 *   optional non-empty string;
 * - `@IsVerificationCode({ optional: true, exactLength: false })` →
 *   `verificationCodeSchema({ exactLength: false }).optional()`.
 */
export const deleteAccountSchema = z
  .object({
    password: z
      .string({ error: '密码不能为空' })
      .min(1, '密码不能为空')
      .describe('当前密码（有密码的用户使用此方式确认注销）')
      .optional(),
    code: verificationCodeSchema({ exactLength: false })
      .describe('邮箱验证码（OAuth-only 用户使用此方式确认注销）')
      .optional(),
  })
  .strict();

/** Strongly typed body of `DELETE /account`. */
export type DeleteAccountDto = z.infer<typeof deleteAccountSchema>;
