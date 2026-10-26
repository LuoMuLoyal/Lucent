/**
 * Port for the clinic-summary PDF renderer.
 *
 * The queue adapter needs to render PDFs but must not import
 * `infrastructure/pdf/document.ts` (`ddd-adapters-no-infrastructure`). It
 * depends on this surface instead; the module binds the token to the concrete
 * renderer with `useExisting`.
 *
 * `ClinicSummaryDto` is imported type-only from the DTO module. That is the
 * same allowance `user-settings` uses for its resource shapes: a `type` import
 * produces no runtime edge, and the DTO is already the single declaration of
 * this wire shape — duplicating it would create a second source of truth for a
 * 300-line structure.
 */

import type { ClinicSummaryDto } from '../../dto/clinic-summary-response.dto.js';
import type { ClinicSummaryOptions } from '../use_cases/build-clinic-summary.js';

/** Injection token for {@link ClinicSummaryPdf}. */
export const CLINIC_SUMMARY_PDF = Symbol('ClinicSummaryPdf');

/** What the queues and controllers need from the PDF renderer. */
export interface ClinicSummaryPdf {
  /** Renders an already-built summary. */
  buildPdf(summary: ClinicSummaryDto, locale: string): Promise<Buffer>;

  /** Builds the summary for `userId` and renders it in one call. */
  exportPdf(
    userId: string,
    locale: string,
    options?: ClinicSummaryOptions,
  ): Promise<Buffer>;
}
