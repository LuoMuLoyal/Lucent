import { z } from 'zod';

import type { UserSettingsResource } from '../../../application/ports/user-settings-resource.js';

/**
 * Standard Schema (zod 4) for the fine-grained assistant context permission
 * block nested in the user settings resource.
 *
 * Response schemas intentionally carry no `.strict()` / `.default()` so
 * outbound parsing tolerates whatever the application layer produces.
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
 * (`GET`/`PATCH /user/settings`).
 *
 * `satisfies z.ZodType<UserSettingsResource>` pins the wire contract to the
 * application-owned type: if either side gains/loses a field or changes its
 * nullability, this file stops compiling. That is the check that replaces
 * "import the DTO from `adapters/`" — the dependency points inward.
 */
const userSettingsShape = z
  .object({
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
  })
  .describe('Authenticated user settings.');

/**
 * The `satisfies` is the drift guard: the schema must produce exactly the
 * application-owned `UserSettingsResource`. Declaring the schema as a named
 * constant (rather than chaining `.satisfies`) keeps its precise `z.infer`
 * type, which `@SerializeOptions` and the OpenAPI exporter rely on.
 */
export const userSettingsDataSchema =
  userSettingsShape satisfies z.ZodType<UserSettingsResource>;

/**
 * The resource as the application port defines it.
 *
 * Re-exported under the historical DTO name so consumers and the port keep
 * importing it from the barrel while the definition — and the dependency
 * direction — lives in `application/ports/`.
 */
export type UserSettingsDataDto = UserSettingsResource;

/** Backwards-compatible response alias kept for the former DTO class name. */
export type UserSettingsResponseDto = UserSettingsDataDto;
