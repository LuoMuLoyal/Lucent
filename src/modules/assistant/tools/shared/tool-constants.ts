import type { DailyRecordKind } from '#generated/prisma/client.js';
import type { AssistantReadConfidence } from '../../types/assistant.types.js';

// ---------------------------------------------------------------------------
// Numerical constants
// ---------------------------------------------------------------------------

/** Default lookback range for assistant date-range reads. */
export const DEFAULT_RANGE_DAYS = 7;

/** Hard cap for assistant date-range reads to avoid oversized context windows. */
export const MAX_RANGE_DAYS = 14;

/**
 * Default / maximum lookback window (days, inclusive of today) for the meal
 * analysis digest. The window is chosen by the model through the tool's `days`
 * argument; the server caps it at {@link MAX_MEAL_DIGEST_DAYS} — a digest is a
 * narrative aid, not a data export, so a wider window buys nothing but tokens.
 */
export const DEFAULT_MEAL_DIGEST_DAYS = 7;
export const MAX_MEAL_DIGEST_DAYS = 15;

/** Default / maximum number of analyzed meals returned by the meal digest. */
export const DEFAULT_MEAL_DIGEST_LIMIT = 20;
export const MAX_MEAL_DIGEST_LIMIT = 20;

/** Default number of recent user messages kept in the assistant prompt context. */
export const DEFAULT_HISTORY_LIMIT = 10;

/** Default offset for proposal target dates (0 = today). */
export const DEFAULT_PROPOSAL_DATE_OFFSET_DAYS = 0;

/** Time-to-live for cached assistant proposals before they expire. */
export const PROPOSAL_TTL_MINUTES = 15;

/** Default page size for assistant vector retrieval tools. */
export const ASSISTANT_VECTOR_DEFAULT_LIMIT = 4;

/** Maximum page size for assistant vector retrieval tools. */
export const ASSISTANT_VECTOR_MAX_LIMIT = 8;

/** Maximum number of recent conversations returned by the assistant conversation list. */
export const RECENT_CONVERSATION_LIMIT = 20;

/** Maximum compact text length before truncation in assistant tool outputs. */
export const MAX_COMPACT_LENGTH = 48;

/** Maximum number of tool execution loops allowed in the assistant runtime graph. */
export const MAX_TOOL_LOOPS = 3;

/**
 * Daily record kinds the assistant write path can create (F-16). Mirrors the
 * union of `AssistantCreateDailyRecordProposalPayload.draft.kind`: the
 * candidate generator may emit exactly these kinds, and the server-side write
 * path (`DailyRecordKind` enum) accepts them. Any candidate kind outside this
 * list is rejected at generation time instead of being silently downgraded.
 */
export const ASSISTANT_CREATE_RECORD_KINDS = [
  'water',
  'meal',
  'symptom',
  'note',
  'sleep',
  'vital',
  'activity',
] as const;

/** Per-tool execution timeout before a tool result is replaced with a timeout envelope (F-6). */
export const TOOL_EXECUTION_TIMEOUT_MS = 20_000;

/** Scoring weights used when ranking daily-record mutation targets. */
export const MUTATION_MATCH_WEIGHTS = {
  kind: 10,
  value: 8,
  title: 9,
  note: 9,
  positionBonus: 3,
} as const;

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------

export const REQUEST_RANGE_CAP_MESSAGE = (
  requestedDays: number,
  maxRangeDays: number,
) =>
  `Requested ${String(requestedDays)} days, but range reads are capped at ${String(maxRangeDays)} days.`;

export const DEFAULT_RANGE_FALLBACK_MESSAGE = (defaultRangeDays: number) =>
  `No explicit range detected, so the lookup defaulted to the last ${String(defaultRangeDays)} days.`;

export const RANGE_TRUNCATED_MESSAGE = (maxRangeDays: number) =>
  `Requested range exceeded ${String(maxRangeDays)} days and was truncated.`;

/**
 * 餐食 digest 窗口被服务端封顶时的说明。
 *
 * `requestedDays` 为 null 只在「模型没传 `days`」时出现，而那种情况不会封顶
 * （`clampPositiveInt` 未传值时按 fallback 走、`capped` 为 false）——所以这里保留
 * 一句话兜底，措辞与 [MEAL_DIGEST_LIMIT_CAP_MESSAGE] 同构，避免将来封顶条件变化时
 * 又渲染出「请求了 30 天，上限 30 天」这种自相矛盾的句子。
 */
export const MEAL_DIGEST_DAYS_CAP_MESSAGE = (
  requestedDays: number | null,
  maxDays: number,
) =>
  requestedDays === null
    ? `The meal-analysis window was capped at ${String(maxDays)} days.`
    : `Requested ${String(requestedDays)} days of meal analysis, but the digest is capped at ${String(maxDays)} days.`;

/**
 * 餐食 digest 只返回最新 `maxLimit` 条时的说明。
 *
 * `requestedLimit` 为 null 表示模型**没有传** `limit`（或传了不可用的值），只是窗口内的
 * 已分析餐食比服务端上限多——此时不能说成「你请求了 N 条」，否则模型会读到
 * 「Requested 20 meals, but the digest returns at most 20 analyzed meals」这种自相矛盾的
 * 句子（两个数字相同，且它根本没请求过）。两条分支因此给不同措辞。
 */
export const MEAL_DIGEST_LIMIT_CAP_MESSAGE = (
  requestedLimit: number | null,
  maxLimit: number,
) =>
  requestedLimit === null
    ? `More analyzed meals were found than the digest returns per call; only the newest ${String(maxLimit)} are included.`
    : `Requested ${String(requestedLimit)} meals, but the digest returns at most ${String(maxLimit)} analyzed meals.`;

// ---------------------------------------------------------------------------
// Shared domain types
// ---------------------------------------------------------------------------

export type ToolDateRange = {
  startDate: string;
  endDate: string;
};

export type ToolRecordItem = {
  id: string;
  kind: DailyRecordKind;
  occurredAt: string;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  tags: string[];
  payload: Record<string, unknown> | null;
  mealAnalysisStatus?: string | null;
  mealAnalysisUpdatedAt?: string | null;
  mealAnalysisFailureReason?: string | null;
  mealHeadline?: string | null;
  mealCalorieMin?: number | null;
  mealCalorieMax?: number | null;
  mealCalorieBucket?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ToolSingleDateResolution = {
  date: string;
  matchedBy: string[];
  ambiguities: string[];
};

/**
 * One analyzed meal in the meal-analysis digest.
 *
 * 读侧来源刻意分层：`analyzed` 判定、`headline` 与 `calorieRange` 全部取**投影列**
 * （`UserDailyRecord.mealHeadline` / `mealCalorie*`），只有 `items` / `dishes` 明细
 * 才回到 `payload.mealAnalysis`；没有分析结果（`analyzing` / `analysis_failed`）的
 * 餐食不进 digest，其 payload 也从不解析。
 *
 * `title` 是记录自身的标题（客户端写入的餐次名，例如「午饭」）：餐食记录没有稳定的
 * 餐次码，凭标题猜 `lunch` 之类正是本链路要废掉的文本启发式，所以原样回标题。
 */
export type ToolMealAnalysisDigestEntry = {
  date: string;
  occurredTime: string | null;
  title: string | null;
  headline: string | null;
  calorieRange: {
    min: number;
    max: number;
    unit: 'kcal';
    bucket: string | null;
  } | null;
  items: Array<{
    rank: number;
    kind: string;
    polarity: string;
    headline: string;
    detail: string;
  }>;
  dishes: string[];
};

export type ToolMealAnalysisDigest = {
  /** Window actually used after the server cap. */
  startDate: string;
  endDate: string;
  windowDays: number;
  limit: number;
  /** What the model asked for (null when the argument was absent or unusable). */
  requestedDays: number | null;
  requestedLimit: number | null;
  daysCapped: boolean;
  limitCapped: boolean;
  /** Analyzed meals found in the window, before the `limit` cut. */
  analyzedMealCount: number;
  meals: ToolMealAnalysisDigestEntry[];
};

export type ToolRangeResolution = ToolDateRange & {
  matchedBy: string[];
  ambiguities: string[];
  truncated: boolean;
  requestedDays: number | null;
};

export type ToolMutationHints = {
  kindHint: string | null;
  numericHint: string | null;
  titleHint: string | null;
  noteHint: string | null;
};

export type ToolMutationRankedRecord = {
  record: ToolRecordItem;
  score: number;
  matchedBy: string[];
};

export type ToolMutationTargetMatch = {
  date: string;
  record: ToolRecordItem | null;
  matchedBy: string[];
  ambiguities: string[];
  reason: string;
  confidence: AssistantReadConfidence;
  candidateCount: number;
};
