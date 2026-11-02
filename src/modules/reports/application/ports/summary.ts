/**
 * Ports for the report AI summary subdomain.
 *
 * The summary use case extends `BaseLlmSummaryService`, which takes the
 * generator instance in its constructor. Naming the concrete generator would
 * mean importing `infrastructure/llm/summary-generator.ts` from `application/`
 * — forbidden by `ddd-application-no-infra-or-adapters`.
 *
 * So the use case depends on this token plus the abstract generator contract
 * (which already lives in `common/`, not in an adapter), and the module binds
 * the token to the concrete implementation with `useExisting`. Same shape as
 * [`REPORT_DASHBOARD_CONTEXT`](./dashboard.ts).
 */

/** Injection token for the report-summary LLM generator. */
export const REPORT_SUMMARY_GENERATOR = Symbol('ReportSummaryGenerator');

/** The abstract generator contract `BaseLlmSummaryService` consumes. */
export type { BaseLlmGeneratorService as SummaryGeneratorContract } from '../../../../common/llm/generators/base-llm-generator.service.js';
