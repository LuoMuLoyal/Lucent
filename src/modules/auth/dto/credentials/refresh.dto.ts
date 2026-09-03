import { z } from 'zod';

/**
 * Standard Schema (zod) for `POST /auth/refresh` body.
 *
 * Migration notes:
 * - `@IsString` + `@IsNotEmpty({ message: 'refreshToken 不能为空' })` →
 *   `z.string({ error: 'refreshToken 不能为空' })` + `.min(1, …)`.
 */
export const refreshSchema = z
  .object({
    refreshToken: z
      .string({ error: 'refreshToken 不能为空' })
      .min(1, 'refreshToken 不能为空')
      .describe('刷新令牌'),
  })
  .strict();

/** Strongly typed body of `POST /auth/refresh`. */
export type RefreshDto = z.infer<typeof refreshSchema>;
