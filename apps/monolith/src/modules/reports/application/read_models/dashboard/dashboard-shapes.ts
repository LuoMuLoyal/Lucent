/**
 * Report dashboard response shapes, owned by the application layer.
 *
 * The read model *produces* these shapes; the HTTP DTO validates and
 * serializes them. `ddd-application-no-infra-or-adapters` and
 * `ddd-infrastructure-no-adapters` both forbid reaching into
 * `adapters/http/dto/`, and the read models and the PDF renderer legitimately
 * need these types — so the shapes live here and the zod schema mirrors them.
 *
 * `adapters/http/dto/report-dashboard-shape.spec.ts` pins the two together in
 * both directions: one-way checking would miss "the schema grew a field the
 * read model never fills", which serializes as `undefined` and breaks clients
 * that type these fields as required.
 *
 * These are declared mutable on purpose. `z.infer` produces mutable object
 * types, so adding `readonly` would make the mirror assertion fail for a reason
 * unrelated to the wire contract.
 */

import type { ReportRange } from './report-range.js';

/** Source kinds an observation can come from. */
export type ReportObservedSourceKind =
  | 'manual'
  | 'health_platform'
  | 'reminder_plan'
  | 'derived';

/** Reliability of the observations behind a metric. */
export type ReportCoverage = 'sufficient' | 'partial' | 'none';

/** How a metric relates to the previous window. */
export type ReportMetricDirection = 'up' | 'down' | 'flat';

/** Qualitative state of a metric or pattern. */
export type ReportMetricStatus =
  | 'good'
  | 'stable'
  | 'needs_attention'
  | 'insufficient_data';

/** Which tracked dimension an item describes. */
export type ReportMetricKind = 'medication' | 'water' | 'sleep';

/** Which advice family a finding or pattern belongs to. */
export type ReportFindingKind =
  | 'medication'
  | 'hydration'
  | 'sleep'
  | 'general';

/** The source-backed observation block — the primary read model. */
export interface ReportObservedMetric {
  value: number | null;
  state: 'observed' | 'unknown';
  coverage: ReportCoverage;
  sources: ReportObservedSourceKind[];
  observedCount: number;
  expectedCount: number | null;
  windowStart: string;
  windowEnd: string;
}

/** One metric card. */
export interface ReportMetric {
  kind: ReportMetricKind;
  value: string;
  unit: string;
  status: ReportMetricStatus;
  delta: string;
  direction: ReportMetricDirection;
  sparkline: number[];
  observedMetric?: ReportObservedMetric | undefined;
}

/** One trend series. */
export interface ReportTrend {
  kind: ReportMetricKind;
  unit: string;
  currentValue: string;
  /** Observed values only — unknown days are omitted, not zero-filled. */
  values: number[];
  observedMetric?: ReportObservedMetric | undefined;
}

/** One localized finding. */
export interface ReportFinding {
  kind: ReportFindingKind;
  title: string;
  body: string;
}

/** One localized pattern. */
export interface ReportPattern {
  kind: ReportFindingKind;
  title: string;
  status: ReportMetricStatus;
  body: string;
  sparkline: number[];
}

/** The dashboard payload. */
export interface ReportDashboardData {
  range: ReportRange;
  startDate: string;
  endDate: string;
  generatedAt: string;
  metrics: ReportMetric[];
  trends: ReportTrend[];
  findings: ReportFinding[];
  patterns: ReportPattern[];
  aiSummaryEnabled: boolean;
}
