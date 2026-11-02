import type { GenerateReportSummaryDto } from '../../application/use_cases/generate-report-summary-command.js';
import type { ReportSummaryDataDto } from '../../application/read_models/report-summary-response.js';

/**
 * Read-only port for AI report summaries.  Consumed by the
 * notification-preferences module to generate weekly insight summaries
 * without depending on the full ReportsAiSummaryService class hierarchy
 * (which extends BaseLlmSummaryService with streaming, persistence, and
 * fallback methods).
 *
 * Registered in ReportsModule via:
 * `{ provide: IReportSummaryReader, useExisting: ReportsAiSummaryService }`
 */
export abstract class IReportSummaryReader {
  abstract generate(
    userId: string,
    dto: GenerateReportSummaryDto,
    language: string,
  ): Promise<ReportSummaryDataDto>;
}
