/**
 * Risk-check request contracts (`application/ports`).
 *
 * The candidate pre-check ("加药前预检") is an application-level input: the use
 * case decides whether to evaluate it, whether it is already in the box, and
 * what to do when its detail is unavailable. It therefore lives here, not in
 * `adapters/http/dto` — the HTTP zod schema (`risk-check.ts`) is built ON this
 * type and is the only place that adds wire-level validation and OpenAPI prose.
 */

import type { MedicineKnowledgeSource } from '../../domain/medicine/medicine-source.js';

/**
 * Trusted-catalogue candidate the client submits before adding a medicine to
 * the box: the knowledge source plus the id inside that source.
 *
 * Deliberately narrower than a free-form `{ source: string; id: string }`:
 * the two sources are the only ones this module can resolve.
 */
export interface RiskCheckCandidateDto {
  source: MedicineKnowledgeSource;
  id: string;
}
