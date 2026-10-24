/**
 * Search-card read model (`application/read_models`).
 *
 * A medicine search card is a **projection**, not an entity: it carries what
 * the list UI needs to render a row and nothing that would imply an invariant
 * (ADR-0024 §4 — read models never get a repository or a write path).
 *
 * This file owns the page-level shape; the field-formatting helpers that build
 * a single card are shared with the persistence layer through
 * `medicine-card.format.ts`.
 */

import type { MedicineCard, MedicinePage } from '../ports/knowledge-view.js';

export type { MedicineCard, MedicinePage };

export {
  composeSubtitle,
  detectMatchedBy,
  firstNonEmpty,
  toPagination,
  truncateText,
  uniqueNonEmptyStrings,
} from './medicine-card.format.js';

/** One page of search cards plus the pagination echo. */
export interface MedicineCardPage {
  items: MedicineCard[];
  pagination: MedicinePage;
}
