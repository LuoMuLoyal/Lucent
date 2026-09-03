import { z } from 'zod';

/**
 * Standard Schema (zod 4) for `PATCH /assistant/conversations/:conversationId`
 * request body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsString` → `z.string()`;
 * - `@IsNotEmpty` → non-empty refine (empty and whitespace-only titles stay
 *   rejected, matching class-validator, without trimming the stored value);
 * - `@MaxLength(48)` → `.max(48)`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown body keys are rejected).
 */
export const renameConversationSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(48)
      .refine((value) => value.trim().length > 0, {
        message: 'title must not be empty',
      })
      .describe(
        'New conversation title (1-48 chars). Empty or whitespace-only titles are rejected; clients keep empty names local-only.',
      ),
  })
  .strict();

/** Strongly typed request body of `PATCH /assistant/conversations/:conversationId`. */
export type RenameConversationDto = z.infer<typeof renameConversationSchema>;
