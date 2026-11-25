import { z } from 'zod';

import {
  DEFAULT_REACTION_DRUG_LIMIT,
  MAX_REACTION_DRUG_LIMIT,
  MIN_REACTION_DRUG_LIMIT,
} from '../../../application/ports/onsides.js';

/**
 * zod 4 Standard Schemas for the OnSIDES adverse-reaction endpoints.
 *
 * OnSIDES is a separate knowledge source (RxNorm ingredient CUI + MedDRA term),
 * not a variant of the DrugBank detail, so it has its own resource shapes.
 *
 * The descriptions say "label-stated" throughout on purpose. These counts are
 * "how many product labels stated this", **not** observed incidence or frequency —
 * a client that renders `labelCount` as "how often it happens" would be making a
 * medical claim the data does not support.
 */

export const ingredientReactionSchema = z.object({
  meddraId: z.string().describe('MedDRA term id.'),
  name: z.string().describe('MedDRA term name.'),
  termType: z.string().describe('MedDRA term type (LLT today).'),
  labelCount: z
    .number()
    .int()
    .describe(
      'Number of distinct product labels that stated this reaction for the ingredient. A count of label statements, not an incidence.',
    ),
  labelSections: z
    .array(z.string())
    .describe(
      'Label sections the statement came from (AR / WP / NA / BW), AR first.',
    ),
  sources: z
    .array(z.string())
    .describe('Regulatory sources of those labels (US / JP / UK / EU).'),
  confidenceMax: z
    .number()
    .nullable()
    .describe(
      'Highest extraction confidence across the statements. Null means unscored (the source omits a score), not a low score. Clients decide the threshold; the backend never filters.',
    ),
});

export const ingredientReactionsResponseSchema = z.object({
  source: z.literal('onsides').describe('Knowledge source discriminator.'),
  rxnormCui: z
    .string()
    .describe('RxNorm ingredient CUI the rows are keyed by.'),
  sourceVersion: z
    .string()
    .describe('Upstream OnSIDES version the rows were imported from.'),
  reactions: z
    .array(ingredientReactionSchema)
    .describe(
      'Label-stated adverse reactions for this ingredient, strongest evidence first. Empty when the ingredient exists but has no statements.',
    ),
});

export const reactionDrugSchema = z.object({
  drugbankId: z
    .string()
    .describe('DrugBank drug id that could cause the reaction.'),
  name: z.string().describe('Drug display name.'),
  labelCount: z
    .number()
    .int()
    .describe('Number of distinct labels linking this drug to the reaction.'),
  confidenceMax: z
    .number()
    .nullable()
    .describe(
      'Highest extraction confidence among those links; null = unscored.',
    ),
});

export const reactionDrugsResponseSchema = z.object({
  source: z.literal('onsides').describe('Knowledge source discriminator.'),
  meddraId: z.string().describe('MedDRA term id the rows are keyed by.'),
  meddraName: z.string().nullable().describe('MedDRA term name.'),
  drugs: z
    .array(reactionDrugSchema)
    .describe(
      'Drugs whose labels state this reaction, most-labelled first. Sorted by label count, not by importance.',
    ),
});

export const reactionDrugsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(MIN_REACTION_DRUG_LIMIT)
    .max(MAX_REACTION_DRUG_LIMIT)
    .optional()
    .default(DEFAULT_REACTION_DRUG_LIMIT),
});

export type IngredientReactionsResponseDto = z.infer<
  typeof ingredientReactionsResponseSchema
>;
export type ReactionDrugsResponseDto = z.infer<
  typeof reactionDrugsResponseSchema
>;
export type ReactionDrugsQueryDto = z.infer<typeof reactionDrugsQuerySchema>;
