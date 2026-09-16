import { z } from 'zod';

import { MEDICINE_KNOWLEDGE_SOURCES } from './source.dto.js';

/**
 * Sequence payloads of `GET /medicines/:id/sequences`.
 *
 * Sequences run to thousands of characters (ABL1 is 1130 aa of protein and
 * 3393 nt of coding sequence), so they are never part of the main detail
 * response — the client asks for this resource only when the user opens the
 * sequence section.
 */

export const drugbankDrugSequenceSchema = z.object({
  description: z
    .string()
    .describe(
      'Chain description exactly as the source header spells it, e.g. "heavy chain".',
    ),
  length: z.number().int().describe('Residue count.'),
  sequence: z.string().describe('Amino-acid sequence.'),
});

export const drugbankTargetSequenceSchema = z.object({
  uniprotId: z.string().describe('UniProt identifier of the target.'),
  targetName: z.string().nullable().describe('Target display name.'),
  dataset: z
    .string()
    .describe('Which sequence this is: protein_fasta or gene_fasta.'),
  length: z.number().int().describe('Residue (protein) or base (gene) count.'),
  sequence: z.string().describe('Sequence content.'),
});

export const medicineSequenceDataSchema = z.object({
  id: z.string().describe('Medicine id in the selected source.'),
  source: z.enum(MEDICINE_KNOWLEDGE_SOURCES).describe('Knowledge source.'),
  drug: drugbankDrugSequenceSchema
    .array()
    .describe('Sequences of the drug itself (biologics have one per chain).'),
  targets: drugbankTargetSequenceSchema
    .array()
    .describe('Sequences of the drug targets, protein and coding gene.'),
});

/** Strongly typed sequence resource returned by `GET /medicines/:id/sequences`. */
export type MedicineSequenceDataDto = z.infer<
  typeof medicineSequenceDataSchema
>;

/** Drug chain sequence embedded in the sequence resource. */
export type DrugbankDrugSequenceDto = z.infer<
  typeof drugbankDrugSequenceSchema
>;

/** Target sequence embedded in the sequence resource. */
export type DrugbankTargetSequenceDto = z.infer<
  typeof drugbankTargetSequenceSchema
>;

/**
 * Counts that ride along with the detail response so the client can label the
 * sequence section before deciding whether to fetch it.
 */
export const sequenceSummarySchema = z.object({
  drugChainCount: z
    .number()
    .int()
    .describe('Number of sequences belonging to the drug itself.'),
  targetSequenceCount: z
    .number()
    .int()
    .describe('Number of target sequences reachable from this drug.'),
});

/** Sequence counts embedded in the drugbank detail variant. */
export type SequenceSummaryDto = z.infer<typeof sequenceSummarySchema>;
