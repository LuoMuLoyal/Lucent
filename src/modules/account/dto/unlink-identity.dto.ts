import { z } from 'zod';

/**
 * Standard Schema (zod 4) for the `DELETE /account/identities/:identityId`
 * request body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsString` → `z.string()`;
 * - `@IsNotEmpty` → `.min(1)` (whitespace-only strings are still accepted,
 *   matching class-validator's `isNotEmpty` which only rejects empty
 *   strings);
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown body keys are rejected) — the migration default is stripping,
 *   but this endpoint keeps the historical strict posture.
 */
export const unlinkIdentitySchema = z
  .object({
    password: z
      .string()
      .min(1, '当前密码不能为空')
      .describe('当前密码(敏感操作再认证用)'),
  })
  .strict();

/** Strongly typed body of `DELETE /account/identities/:identityId`. */
export type UnlinkIdentityDto = z.infer<typeof unlinkIdentitySchema>;
