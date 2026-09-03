import { z } from 'zod';

/**
 * Standard Schema (zod 4) for the fine-grained assistant context permission
 * block nested in the user settings resource.
 *
 * Replaces the former `AssistantContextSettingsDto` response class.
 * Response schemas intentionally carry no `.strict()` / `.default()` so
 * outbound parsing tolerates whatever the service layer produces.
 */
export const assistantContextSettingsSchema = z.object({
  healthProfile: z
    .boolean()
    .describe(
      'Whether the assistant may read stored health profile, allergies, and conditions.',
    ),
  dailyRecords: z
    .boolean()
    .describe('Whether the assistant may read recent daily records.'),
  sleepRecords: z
    .boolean()
    .describe('Whether the assistant may read sleep records and summaries.'),
  currentMedicines: z
    .boolean()
    .describe(
      'Whether the assistant may read current medicines and medicine-box data.',
    ),
});

/** Strongly typed assistant context permission flags. */
export type AssistantContextSettingsDto = z.infer<
  typeof assistantContextSettingsSchema
>;

/**
 * Standard Schema (zod 4) for the authenticated user's settings resource
 * (`GET`/`PATCH /settings`).
 *
 * Replaces the former `UserSettingsDataDto` response class.
 */
export const userSettingsDataSchema = z.object({
  aiSummariesEnabled: z
    .boolean()
    .describe('Allow AI-generated summaries and advice.'),
  dataSharingConsent: z
    .boolean()
    .describe('Consent to share anonymized data for research.'),
  assistantEnabled: z
    .boolean()
    .describe('Allow the authenticated user to use the assistant feature.'),
  assistantMemoryEnabled: z
    .boolean()
    .describe(
      'Allow the assistant to reuse persisted conversation history as cross-conversation memory.',
    ),
  waterTargetCount: z
    .number()
    .describe('Daily water intake target (number of glasses).'),
  assistantContext: assistantContextSettingsSchema.describe(
    'Fine-grained assistant context permissions.',
  ),
  updatedAt: z
    .string()
    .nullable()
    .describe('ISO-8601 timestamp of last update.'),
  passwordReauthenticationRequired: z
    .boolean()
    .describe(
      'Whether sensitive operations require password re-authentication.',
    ),
});

/** Strongly typed user settings resource. */
export type UserSettingsDataDto = z.infer<typeof userSettingsDataSchema>;

/** Backwards-compatible response alias kept for the former DTO class name. */
export type UserSettingsResponseDto = UserSettingsDataDto;
