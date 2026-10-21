import { z } from 'zod';

/**
 * Computed structure descriptors of `GET /medicines/:id`, from
 * `drugbank_structures`.
 *
 * These are small scalars, so unlike sequences they ride along with the detail
 * response. Every field is nullable: coverage in the source ranges from 100%
 * (formula, molecular weight) down to roughly 15% (pKa).
 *
 * `traditionalIupacName` is deliberately absent — the upstream column is
 * systematically wrong (see the `DrugbankStructure` model comment).
 */
export const medicineStructureSchema = z.object({
  // Identity and identifiers.
  smiles: z.string().nullable().describe('Canonical SMILES.'),
  inchiKey: z.string().nullable().describe('InChIKey hash.'),
  inchiIdentifier: z.string().nullable().describe('Full InChI string.'),
  formula: z.string().nullable().describe('Molecular formula.'),
  iupacName: z.string().nullable().describe('IUPAC name.'),

  // Mass.
  molecularWeight: z.number().nullable().describe('Average molecular weight.'),
  exactMass: z.number().nullable().describe('Monoisotopic exact mass.'),

  // Physicochemical.
  logP: z.number().nullable().describe('Wildman-Crippen LogP.'),
  polarSurfaceArea: z
    .number()
    .nullable()
    .describe('Topological polar surface area (A^2).'),
  polarizability: z.number().nullable().describe('Average polarizability.'),
  refractivity: z.number().nullable().describe('Molar refractivity.'),
  alogpsLogP: z.number().nullable().describe('ALOGPS LogP.'),
  alogpsLogS: z.number().nullable().describe('ALOGPS water solubility (log).'),
  alogpsSolubility: z
    .string()
    .nullable()
    .describe('ALOGPS water solubility with units, e.g. "4.64e-02 g/l".'),
  pka: z.number().nullable().describe('Strongest pKa.'),
  pkaStrongestAcidic: z.number().nullable().describe('Strongest acidic pKa.'),
  pkaStrongestBasic: z.number().nullable().describe('Strongest basic pKa.'),

  // Charge.
  formalCharge: z.number().int().nullable().describe('Formal charge.'),
  physiologicalCharge: z
    .number()
    .int()
    .nullable()
    .describe('Charge at physiological pH.'),
  neutralCharge: z
    .number()
    .int()
    .nullable()
    .describe('Charge of the neutral form.'),
  averageNeutralMicrospeciesCharge: z
    .number()
    .nullable()
    .describe('Average charge across neutral microspecies.'),

  // Size / shape counts.
  atomCount: z.number().int().nullable().describe('Heavy atom count.'),
  ringCount: z.number().int().nullable().describe('Number of rings.'),
  rotatableBondCount: z
    .number()
    .int()
    .nullable()
    .describe('Number of rotatable bonds.'),
  acceptorCount: z
    .number()
    .int()
    .nullable()
    .describe('Hydrogen-bond acceptors.'),
  donorCount: z.number().int().nullable().describe('Hydrogen-bond donors.'),

  // Drug-likeness rule verdicts. The source stores them as 0/1 flags.
  ruleOfFive: z
    .number()
    .int()
    .nullable()
    .describe('Lipinski rule-of-five pass (1/0).'),
  veberRule: z
    .number()
    .int()
    .nullable()
    .describe('Veber oral bioavailability rule (1/0).'),
  ghoseFilter: z.number().int().nullable().describe('Ghose filter pass (1/0).'),
  mddrLikeRule: z
    .number()
    .int()
    .nullable()
    .describe('MDDR-like rule pass (1/0).'),
  bioavailability: z
    .number()
    .int()
    .nullable()
    .describe('Bioavailability score class (0/1).'),

  /** Salt forms the drug is supplied as. */
  salts: z.array(z.string()).nullable().describe('Salt forms.'),
});

/** Strongly typed structure block of the drugbank detail variant. */
export type MedicineStructureDto = z.infer<typeof medicineStructureSchema>;
