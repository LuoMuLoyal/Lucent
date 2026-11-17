import { z } from 'zod';

/**
 * Standard Schema (zod) for `POST /auth/logout` body.
 *
 * Migration notes:
 * - `@IsString` + `@IsNotEmpty({ message: 'refreshToken 不能为空' })` →
 *   `z.string({ error: 'refreshToken 不能为空' })` (base error covers a
 *   missing/non-string value) + `.min(1, …)` (covers an empty string).
 */
export const logoutSchema = z
  .object({
    refreshToken: z
      .string({ error: 'validation.field.required' })
      .min(1, 'validation.field.required')
      .describe('刷新令牌'),
  })
  .strict();

/** Strongly typed body of `POST /auth/logout`. */
export type LogoutDto = z.infer<typeof logoutSchema>;
