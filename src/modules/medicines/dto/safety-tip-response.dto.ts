import { z } from 'zod';

/**
 * zod 4 Standard Schema for the `GET /medicines/safety-tips` response items.
 *
 * Migrated from the former `@ApiProperty` response class (class name kept as
 * `z.infer` type alias). No `.strict()` / `.default()`.
 */

export const medicineSafetyTipResponseSchema = z.object({
  id: z.string().describe('Safety tip id.'),
  text: z.string().describe('Localized safety tip text.'),
  category: z.string().describe('Tip category.'),
});

/** Array schema of the `GET /medicines/safety-tips` success body. */
export const medicineSafetyTipsResponseSchema = z
  .array(medicineSafetyTipResponseSchema)
  .describe('Random medication safety tips.');

/** Strongly typed safety tip item. */
export type MedicineSafetyTipResponseDto = z.infer<
  typeof medicineSafetyTipResponseSchema
>;
