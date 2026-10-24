/**
 * Transport-facing presenters for the medicine endpoints.
 *
 * The field-formatting helpers themselves live in
 * `application/read_models/medicine-card.format.ts`: the persistence layer
 * builds the same projections and must not import `adapters/`, so a shared
 * home is needed (ADR-0024 layer rule D4). This module stays as the delivery
 * adapter's own surface and re-exports them for the HTTP layer.
 */

export {
  composeSubtitle,
  detectMatchedBy,
  firstNonEmpty,
  toDrugbankDrugInteractions,
  toDrugbankExternalIdentifiers,
  toDrugbankExternalLinks,
  toPagination,
  toStringList,
  toStringListOrNull,
  truncateText,
  uniqueNonEmptyStrings,
} from '../../../application/read_models/medicine-card.format.js';
