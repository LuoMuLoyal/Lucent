/**
 * Dashboard read-model ports (ADR-0024 D2).
 *
 * `application/` may not import `adapters/`, so the use case cannot name
 * `ReportsContextService` (which lives in `adapters/acl/`) or the HTTP query
 * DTO. Both are declared here instead:
 *
 * - {@link ReportDashboardQuery} is the use case's input vocabulary.
 * - {@link REPORT_DASHBOARD_CONTEXT} + {@link DashboardContextPort} describe the
 *   cross-context read the ACL performs.
 *
 * The module binds the token to the ACL implementation with `useExisting`, and
 * `adapters/http/dto/report-dashboard-query.ts` pins its zod schema to
 * `ReportDashboardQuery` (`report-dashboard-shape.spec.ts` asserts both
 * directions), so the two cannot drift.
 */

import type { ReportDashboardFacts } from '../read_models/dashboard/metrics.types.js';
import type { ReportRange } from '../read_models/dashboard/report-range.js';

/**
 * Input vocabulary of `GET /reports/dashboard`.
 *
 * Explicit `| undefined` on every key because `z.infer` of an optional key is
 * `T | undefined`, which `exactOptionalPropertyTypes` distinguishes from a bare
 * optional `T` (same resolution as `user-settings`' `UpdateUserSettingsCommand`).
 */
export interface ReportDashboardQuery {
  range?: ReportRange | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
}

/** Injection token for {@link DashboardContextPort}. */
export const REPORT_DASHBOARD_CONTEXT = Symbol('ReportDashboardContext');

/**
 * The cross-context read the dashboard needs: settings + dose-log facts +
 * daily-record facts, aggregated into one facts object.
 *
 * Implemented by `adapters/acl/dashboard-context.ts`, which reaches each source
 * through its *reader port* (`IUserSettingsPort`, `MedicineDoseLogReaderPort`,
 * `DailyRecordReaderPort`) — never through another context's tables.
 */
export interface DashboardContextPort {
  build(
    userId: string,
    query: ReportDashboardQuery,
  ): Promise<ReportDashboardFacts>;
}
