import { z } from 'zod';

import { MEDICINE_KNOWLEDGE_SOURCES } from './source.dto.js';

/**
 * zod 4 Standard Schemas for the medicine detail response bodies
 * (`GET /medicines/:id`).
 *
 * Migrated from the former `@ApiProperty` response classes (class names kept
 * as `z.infer` type aliases; descriptions preserved via `.describe`):
 * - nullable columns → `.nullable()` (key always present, value may be null);
 * - `kind` discriminator stays a literal, so the two detail variants are
 *   modelled as a `z.discriminatedUnion` on `kind`;
 * - source lists that the adapters always emit as arrays are
 *   `z.array(z.string()).nullable()` (accepts `[]` as well as `null`);
 * - raw source JSON payloads stay `unknown` (Prisma `Json?` values).
 *
 * No `.strict()` / `.default()`: outbound validation must accept exactly the
 * wire shape produced by the medicine adapters.
 */

export const drugbankDrugInteractionSchema = z.object({
  drugbankId: z.string().describe('Interacting DrugBank drug id.'),
  description: z.string().describe('Interaction description.'),
});

export const drugbankMedicineDetailSchema = z.object({
  kind: z.literal('drugbank'),
  drugType: z.string().nullable().describe('Drug type (e.g. small molecule).'),
  state: z.string().nullable().describe('Physical state (e.g. solid).'),
  description: z.string().nullable().describe('Drug description.'),
  indication: z.string().nullable().describe('Approved indications.'),
  mechanismOfAction: z.string().nullable().describe('Mechanism of action.'),
  pharmacodynamics: z.string().nullable().describe('Pharmacodynamics.'),
  toxicity: z.string().nullable().describe('Toxicity summary.'),
  metabolism: z.string().nullable().describe('Metabolism summary.'),
  absorption: z.string().nullable().describe('Absorption summary.'),
  halfLife: z.string().nullable().describe('Half life.'),
  proteinBinding: z.string().nullable().describe('Protein binding.'),
  routeOfElimination: z.string().nullable().describe('Route of elimination.'),
  volumeOfDistribution: z
    .string()
    .nullable()
    .describe('Volume of distribution.'),
  clearance: z.string().nullable().describe('Clearance.'),
  groups: z
    .array(z.string())
    .nullable()
    .describe('Approval groups (e.g. approved, small molecule).'),
  categories: z.array(z.string()).nullable().describe('ATC-like categories.'),
  atcCodes: z.array(z.string()).nullable().describe('ATC codes.'),
  synonyms: z.array(z.string()).nullable().describe('Synonyms.'),
  foodInteractions: z
    .array(z.string())
    .nullable()
    .describe('Food interactions.'),
  drugInteractions: drugbankDrugInteractionSchema
    .array()
    .nullable()
    .describe('DrugBank interaction entries used for interaction checking.'),
  externalIdentifiers: z
    .unknown()
    .nullable()
    .describe('Raw source external identifier payload.'),
  externalLinks: z
    .unknown()
    .nullable()
    .describe('Raw source external link payload.'),
});

export const cnMedicineDetailSchema = z.object({
  kind: z.literal('cnProduct'),
  approvalNumber: z.string().nullable().describe('Approval number (国药准字).'),
  manufacturer: z.string().nullable().describe('Manufacturer.'),
  packageSpec: z.string().nullable().describe('Package specification.'),
  brandName: z.string().nullable().describe('Brand name.'),
  ingredients: z.string().nullable().describe('Ingredients.'),
  properties: z.string().nullable().describe('Properties.'),
  indications: z.string().nullable().describe('Indications.'),
  dosage: z.string().nullable().describe('Dosage.'),
  adverseReactions: z.string().nullable().describe('Adverse reactions.'),
  contraindications: z.string().nullable().describe('Contraindications.'),
  precautions: z.string().nullable().describe('Precautions.'),
  pharmacologyToxicology: z
    .string()
    .nullable()
    .describe('Pharmacology / toxicology.'),
  pharmacokinetics: z.string().nullable().describe('Pharmacokinetics.'),
  overdose: z.string().nullable().describe('Overdose handling.'),
  storage: z.string().nullable().describe('Storage conditions.'),
  validityPeriod: z.string().nullable().describe('Validity period.'),
  barcode: z.string().nullable().describe('Barcode.'),
  nationalDrugCode: z.string().nullable().describe('National drug code.'),
  sourceUrl: z.string().nullable().describe('Source URL.'),
  imageUrl: z.string().nullable().describe('Image URL.'),
});

export const medicineDetailDataSchema = z.object({
  id: z.string().describe('Medicine id in the selected source.'),
  source: z.enum(MEDICINE_KNOWLEDGE_SOURCES).describe('Knowledge source.'),
  name: z.string().describe('Display name.'),
  subtitle: z.string().nullable().describe('Short supporting subtitle.'),
  detail: z.discriminatedUnion('kind', [
    drugbankMedicineDetailSchema,
    cnMedicineDetailSchema,
  ]),
});

/** Strongly typed detail resource returned by `GET /medicines/:id`. */
export type MedicineDetailDataDto = z.infer<typeof medicineDetailDataSchema>;

/** DrugBank interaction entry embedded in a drugbank detail variant. */
export type DrugbankDrugInteractionDto = z.infer<
  typeof drugbankDrugInteractionSchema
>;

/** DrugBank knowledge-source detail variant. */
export type DrugbankMedicineDetailDto = z.infer<
  typeof drugbankMedicineDetailSchema
>;

/** CN product knowledge-source detail variant. */
export type CnMedicineDetailDto = z.infer<typeof cnMedicineDetailSchema>;
