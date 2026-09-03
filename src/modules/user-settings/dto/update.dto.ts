import { z } from 'zod';

/**
 * Standard Schema (zod 4) for `PATCH /settings` request bodies.
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` + `@IsBoolean` → `.boolean().optional()`;
 * - `@IsInt` + `@Min/@Max` → `z.number().int().min().max()`;
 * - `@ValidateNested` + `@Type(() => X)` → nested schema reference;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   on the top-level and the nested object (unknown keys are rejected).
 */
const updateAssistantContextSettingsSchema = z
  .object({
    healthProfile: z
      .boolean()
      .describe(
        'Allow the assistant to read stored health profile, allergies, and conditions.',
      )
      .optional(),
    dailyRecords: z
      .boolean()
      .describe('Allow the assistant to read recent daily records.')
      .optional(),
    sleepRecords: z
      .boolean()
      .describe('Allow the assistant to read sleep records and summaries.')
      .optional(),
    currentMedicines: z
      .boolean()
      .describe(
        'Allow the assistant to read current medicines and medicine-box data.',
      )
      .optional(),
  })
  .strict();

export const updateUserSettingsSchema = z
  .object({
    aiSummariesEnabled: z
      .boolean()
      .describe('Allow AI-generated summaries and advice.')
      .optional(),
    dataSharingConsent: z
      .boolean()
      .describe('Consent to share anonymized data for research.')
      .optional(),
    assistantEnabled: z
      .boolean()
      .describe('Allow the authenticated user to use the assistant feature.')
      .optional(),
    assistantMemoryEnabled: z
      .boolean()
      .describe(
        'Allow the assistant to reuse persisted conversation history as cross-conversation memory.',
      )
      .optional(),
    waterTargetCount: z
      .number()
      .int()
      .min(1)
      .max(30)
      .describe('Daily water intake target (number of glasses).')
      .optional(),
    assistantContext: updateAssistantContextSettingsSchema
      .describe('Fine-grained permissions for what the assistant may read.')
      .optional(),
  })
  .strict();

/** Strongly typed request body of `PATCH /settings`. */
export type UpdateUserSettingsDto = z.infer<typeof updateUserSettingsSchema>;

/** Nested assistant-context portion of the update body. */
export type UpdateAssistantContextSettingsDto = z.infer<
  typeof updateAssistantContextSettingsSchema
>;
