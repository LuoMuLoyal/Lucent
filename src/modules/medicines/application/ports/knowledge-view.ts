/**
 * Knowledge-view projections (`application/ports`).
 *
 * These are the shapes the persistence layer PRODUCES for the read endpoints:
 * the search card, the discriminated detail union, and the sequence resource.
 * They are declared here because the persistence implementations must not
 * import `adapters/http/dto` — delivery adapters and infrastructure both point
 * inward at this file, and the HTTP zod schemas keep being the single source
 * of truth for what actually goes over the wire (they are structurally
 * compatible with these projections).
 *
 * Kept structural (`Record<string, unknown>` for the nested JSON columns) for
 * the same reason as `MedicineDetailPayload`: the columns hold source JSON
 * whose exact shape is the upstream dataset's business, not the domain's.
 */

import type { MedicineKnowledgeSource } from '../../domain/medicine/medicine-source.js';
import type { MedicineDetailPayload } from '../../domain/services/ingredient-canonicalization.js';

// ─── Search ────────────────────────────────────────────────────────────────

/** One search card (`GET /medicines` item). */
export interface MedicineCard {
  id: string;
  source: MedicineKnowledgeSource;
  name: string;
  subtitle: string | null;
  summary: string | null;
  tags: string[];
  imageUrl: string | null;
  matchedBy: string[];
}

/** Pagination echoed back with a search result page. */
export interface MedicinePage {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ─── Detail ────────────────────────────────────────────────────────────────

/** Interaction entry: the other drug plus what the source says about it. */
export interface MedicineInteraction {
  drugbankId: string;
  description: string;
}

/** External cross-reference, e.g. `{ resource: 'PubChem Compound', identifier: '5291' }`. */
export interface MedicineExternalIdentifier {
  resource: string;
  identifier: string;
}

/** Outbound reference link, e.g. `{ resource: 'Drugs.com', url: 'https://...' }`. */
export interface MedicineExternalLink {
  resource: string;
  url: string;
}

/** One target (protein/gene) the drug acts on, with edge-level relationship data. */
export interface MedicineTarget {
  name: string;
  geneName: string | null;
  uniprotId: string | null;
  uniprotTitle: string | null;
  species: string | null;
  pdbIds: string[] | null;
  actions: string[] | null;
  knownAction: string | null;
  relationKind: string | null;
}

/**
 * Computed structure descriptors (`drugbank_structures`).
 *
 * Every field is nullable: coverage in the source ranges from 100% (formula,
 * molecular weight) down to roughly 15% (pKa). These are small scalars, so
 * unlike sequences they ride along with the detail response.
 */
export interface MedicineStructure {
  smiles: string | null;
  inchiKey: string | null;
  inchiIdentifier: string | null;
  formula: string | null;
  iupacName: string | null;
  molecularWeight: number | null;
  exactMass: number | null;
  logP: number | null;
  polarSurfaceArea: number | null;
  polarizability: number | null;
  refractivity: number | null;
  alogpsLogP: number | null;
  alogpsLogS: number | null;
  alogpsSolubility: string | null;
  pka: number | null;
  pkaStrongestAcidic: number | null;
  pkaStrongestBasic: number | null;
  formalCharge: number | null;
  physiologicalCharge: number | null;
  neutralCharge: number | null;
  averageNeutralMicrospeciesCharge: number | null;
  atomCount: number | null;
  ringCount: number | null;
  rotatableBondCount: number | null;
  acceptorCount: number | null;
  donorCount: number | null;
  ruleOfFive: number | null;
  veberRule: number | null;
  ghoseFilter: number | null;
  mddrLikeRule: number | null;
  bioavailability: number | null;
  salts: string[] | null;
}

/**
 * DrugBank detail variant — the raw science fields, plus the two derived
 * blocks (`sequenceSummary` counts only, `structure` scalars).
 */
export interface DrugbankMedicineDetail extends MedicineDetailPayload {
  kind: 'drugbank';
  drugType: string | null;
  state: string | null;
  description: string | null;
  indication: string | null;
  mechanismOfAction: string | null;
  pharmacodynamics: string | null;
  toxicity: string | null;
  metabolism: string | null;
  absorption: string | null;
  halfLife: string | null;
  proteinBinding: string | null;
  routeOfElimination: string | null;
  volumeOfDistribution: string | null;
  clearance: string | null;
  groups: string[] | null;
  categories: string[] | null;
  atcCodes: string[] | null;
  synonyms: string[] | null;
  foodInteractions: string[] | null;
  drugInteractions: MedicineInteraction[] | null;
  targets: MedicineTarget[] | null;
  externalIdentifiers: MedicineExternalIdentifier[] | null;
  externalLinks: MedicineExternalLink[] | null;
  sequenceSummary: MedicineSequenceSummary | null;
  structure: MedicineStructure | null;
}

/**
 * CN product detail variant.
 *
 * `properties` is the leaflet's `appearance` column; body text lives in the
 * leaflet reached via the 1:1 link, never on the catalogue row.
 */
export interface CnMedicineDetail extends MedicineDetailPayload {
  kind: 'cnProduct';
  approvalNumber: string | null;
  manufacturer: string | null;
  packageSpec: string | null;
  brandName: string | null;
  ingredients: string | null;
  properties: string | null;
  indications: string | null;
  dosage: string | null;
  adverseReactions: string | null;
  contraindications: string | null;
  precautions: string | null;
  pharmacologyToxicology: string | null;
  pharmacokinetics: string | null;
  overdose: string | null;
  storage: string | null;
  validityPeriod: string | null;
  barcode: string | null;
  nationalDrugCode: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
}

/** Discriminated detail union: each source keeps its native fields. */
export type MedicineDetailVariant = DrugbankMedicineDetail | CnMedicineDetail;

/** One medicine detail resource (`GET /medicines/:id`). */
export interface MedicineDetailView {
  id: string;
  source: MedicineKnowledgeSource;
  name: string;
  subtitle: string | null;
  detail: MedicineDetailVariant;
}

// ─── Sequences ─────────────────────────────────────────────────────────────

/** One chain of the drug itself (biologics have one per chain). */
export interface DrugChainSequence {
  description: string;
  length: number;
  sequence: string;
}

/** One target sequence — protein or its coding gene. */
export interface MedicineTargetSequence {
  uniprotId: string;
  targetName: string | null;
  dataset: string;
  length: number;
  sequence: string;
}

/**
 * Counts that ride along with the detail response so the client can label the
 * sequence section before deciding whether to fetch it.
 */
export interface MedicineSequenceSummary {
  drugChainCount: number;
  targetSequenceCount: number;
}

/**
 * One medicine's sequences (`GET /medicines/:id/sequences`).
 *
 * Deliberately separate from the detail: a single drug reaches ~96 KB of
 * sequence (Imatinib: 28 targets × 2 datasets), which must not ride along with
 * every detail request.
 */
export interface MedicineSequenceView {
  id: string;
  source: MedicineKnowledgeSource;
  drug: DrugChainSequence[];
  targets: MedicineTargetSequence[];
}
