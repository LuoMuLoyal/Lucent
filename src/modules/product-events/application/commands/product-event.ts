/**
 * 产品事件的应用层形状 —— 不复用 HTTP 层的 zod 输出类型。
 *
 * `application/` 不得依赖 `adapters/`（`arch:check` 会拦）。投递层把校验过的
 * 请求体映射成这些形状。
 */

/**
 * 未来偏移窗口：`occurredAt` 最多允许超前多久。
 *
 * 超过它的写入永远无法匹配 90 天保留清理（清理按 `occurredAt` 扫），
 * 等于数据永远留着——所以服务端要在写入前挡住。
 */
export const MAX_PRODUCT_EVENT_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/** 漏斗可选的最大窗口天数。 */
export const MAX_FUNNEL_RANGE_DAYS = 30;

/** 一条待记录的事件（已过 HTTP 校验，仍需服务端边界校验）。 */
export interface ProductEventCommand {
  clientEventId: string;
  name: string;
  surface: string;
  result: string;
  eventStatus?: string | undefined;
  suggestionRuleCode?: string | undefined;
  appVersion: string;
  platform: string;
  occurredAt: string;
}

/** 漏斗查询的时间窗输入。 */
export interface FunnelQuery {
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

/** 核心漏斗五阶段的分日计数。 */
export interface FunnelDailyCounts {
  date: string;
  eventStarted: number;
  suggestionImpression: number;
  suggestionActioned: number;
  eventEndedOrOutcome: number;
  reviewOpened: number;
}

/** 到访汇总的可选计数。 */
export interface FunnelOptionalCounts {
  visitSummaryPreviewed: number;
  visitSummaryExported: number;
  visitSummaryShareCreated: number;
  visitSummaryShareOpened: number;
}

/** 窗口跨度的漏斗总计。 */
export interface FunnelTotals {
  eventStarted: number;
  suggestionImpression: number;
  suggestionActioned: number;
  eventEndedOrOutcome: number;
  reviewOpened: number;
}

/** 查询窗口的元信息。 */
export interface FunnelWindow {
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  detailsSuppressed: boolean;
}

/** 漏斗响应。 */
export interface FunnelData {
  daily: FunnelDailyCounts[];
  optional: FunnelOptionalCounts;
  totals: FunnelTotals;
  window: FunnelWindow;
}
