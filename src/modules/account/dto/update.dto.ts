import { z } from 'zod';

/**
 * Standard Schema (zod 4) for `PATCH /account` request body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` → `.optional()` (absent keys stay `undefined`);
 * - `@IsString` → `z.string()`;
 * - `@MaxLength(20)` → `.max(20)` (inclusive, same semantics);
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown body keys are rejected) — the migration default is stripping,
 *   but this endpoint keeps the historical strict posture.
 */
export const updateAccountSchema = z
  .object({
    nickname: z
      .string()
      .max(20, '昵称最多 20 个字符')
      .describe('Display nickname. Send an empty string to clear it.')
      .optional(),
    avatar: z
      .string()
      .describe('Avatar URL. Send an empty string to clear it.')
      .optional(),
  })
  .strict();

/** Strongly typed body of `PATCH /account`. */
export type UpdateAccountDto = z.infer<typeof updateAccountSchema>;
