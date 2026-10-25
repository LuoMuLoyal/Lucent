/**
 * Write-side repository port for the `Summary` aggregate
 * (`domain/summary/summary.ts`, ADR-0024 §4).
 *
 * The read methods at the bottom ship through the same port on purpose: both
 * kinds of summary are this context's **own** projection (nothing else writes
 * them, nothing else reads them), so splitting them into a separate read model
 * would add a second interface with no second consumer. The rule from ADR-0024 §4
 * that matters is the other one — no repository method is a query DSL: each read
 * names the question it answers.
 *
 * Layer purity: only `domain/` types (ADR-0024 rule D1).
 */

import type { ReportRange, SummaryKind, SummaryScope } from './summary.js';

/** DI token — string so Nest resolution errors name the port readably. */
export const ASSISTANT_SUMMARIES = 'ASSISTANT_SUMMARIES';

/** One bullet of a "today" summary. */
export interface SummaryBullet {
  kind: string;
  text: string;
}

/** How many days of a dimension the summary actually covered. */
export interface CoverageDimension {
  trackedDays: number;
  totalDays: number;
}

/** Today summary as persisted and read back. */
export interface TodaySummaryRecord {
  date: string | null;
  generatedAt: string;
  summary: string;
  bullets: SummaryBullet[];
  actionLabel: string;
  action: string;
  confidenceNote: string;
  aiGenerated?: boolean;
  sourceVersion?: number | null;
}

/** Report summary as persisted and read back. */
export interface ReportSummaryRecord {
  rangeKey: string | null;
  startDate: string | null;
  endDate: string | null;
  generatedAt: string;
  summary: string;
  coverage?: {
    medication: CoverageDimension;
    water: CoverageDimension;
    sleep: CoverageDimension;
  } | null;
  observedPattern?: { kind: string; text: string; source: string } | null;
  lowRiskAction?: { label: string; text: string } | null;
  disclaimer?: string | null;
  /** Legacy columns still present on today rows; report rows store empty ones. */
  bullets: SummaryBullet[];
  actionLabel: string;
  action: string;
  confidenceNote: string;
}

/** Everything a writer supplies for a summary of either kind. */
export interface SummaryWrite {
  userId: string;
  /**
   * What the summary covers. Persistence derives the storage key from it
   * (`scopeKeyOf`), so the key cannot disagree with the scope it names.
   */
  scope?: SummaryScope;
  /** Legacy flat form of `scope`; accepted because callers still pass it. */
  kind?: SummaryKind;
  date?: string | null;
  rangeKey?: ReportRange | null;
  startDate?: string | null;
  endDate?: string | null;
  /** Legacy explicit storage key; persistence derives it from `scope`. */
  scopeKey?: string;
  generatedAt: string;
  summary: string;
  aiGenerated?: boolean;
  sourceVersion?: number | null;
  /** Today-summary fields (ignored for `kind='report'`). */
  bullets?: SummaryBullet[];
  actionLabel?: string;
  action?: string;
  confidenceNote?: string;
  /** Report-summary fields (ignored for `kind='today'`). */
  coverage?: ReportSummaryRecord['coverage'];
  observedPattern?: ReportSummaryRecord['observedPattern'];
  lowRiskAction?: ReportSummaryRecord['lowRiskAction'];
  disclaimer?: string | null;
}

/** Range selector for a report lookup. */
export interface ReportRangeQuery {
  rangeKey?: ReportRange | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface SummaryRepositoryPort {
  /**
   * Stores a summary, applying the version fence (`mayReplaceSummary`).
   *
   * Returns whether the row was actually written — `false` means a newer version
   * had already been stored, which is an expected outcome of rule 2, not a
   * failure.
   */
  save(write: SummaryWrite): Promise<{ written: boolean }>;

  listRecentToday(userId: string, limit: number): Promise<TodaySummaryRecord[]>;

  listRecentReports(
    userId: string,
    limit: number,
  ): Promise<ReportSummaryRecord[]>;

  findTodayByDate(
    userId: string,
    date: string,
  ): Promise<TodaySummaryRecord | null>;

  findReportByRange(
    userId: string,
    query: ReportRangeQuery,
  ): Promise<ReportSummaryRecord | null>;
}
