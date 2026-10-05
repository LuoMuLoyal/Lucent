import { z } from 'zod';

/**
 * Standard Schema (zod) for `POST /auth/verify-email` body.
 *
 * Migration notes:
 * - `@IsString({ message: 'token 必须是字符串' })` +
 *   `@IsNotEmpty({ message: 'token 不能为空' })` → a non-empty string; the
 *   base `error` param preserves the not-empty wording for missing tokens.
 */
export const verifyEmailSchema = z
  .object({
    token: z
      .string({ error: 'validation.field.required' })
      .min(1, 'validation.field.required')
      .describe('Lucent 签发的邮件验证 token'),
  })
  .strict();

/** Strongly typed body of `POST /auth/verify-email`. */
export type VerifyEmailDto = z.infer<typeof verifyEmailSchema>;
