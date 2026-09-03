import { z } from 'zod';

/**
 * Standard Schema (zod 4) for one cold-start onboarding guide card returned
 * by `GET /today-analysis/recommendations`. Replaces the former
 * `TodayRecommendationResponseDto` response class.
 */
export const todayRecommendationResponseSchema = z.object({
  id: z.string().describe('Unique recommendation id'),
  text: z.string().describe('Recommendation text'),
  category: z.string().optional().describe('Recommendation category'),
});

/** Strongly typed cold-start onboarding guide card. */
export type TodayRecommendationResponseDto = z.infer<
  typeof todayRecommendationResponseSchema
>;

/**
 * Array schema of the `GET /today-analysis/recommendations` success body.
 * Outbound validation uses the item schema (the global serializer validates
 * array items one by one); this array schema backs the OpenAPI registration.
 */
export const todayRecommendationsResponseSchema = z
  .array(todayRecommendationResponseSchema)
  .describe('Cold-start onboarding guide cards.');
