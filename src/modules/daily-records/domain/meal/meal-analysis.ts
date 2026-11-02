/**
 * 餐食分析（值对象 + 规范化规则）—— 记录的 payload，不是独立聚合。
 *
 * ## 契约 v2：一次多模态分析直出
 *
 * 为什么换掉 v1：v1 走「视觉识别菜品 → 菜品分解 → 成分接地对照食物成分表 → 算热量」，
 * 实测在真实照片上行不通（误差逐段放大成没有意义的数字，且要维护一张覆盖真实饮食的
 * 成分表）。v2 改为**一次多模态分析直出**：热量区间 + 按重要性排序的结论 + 收敛的机器词表。
 *
 * ## 三条不变量
 *
 * - `calorieRange` 是独立字段，**不参与 `items` 排序**；只给区间与档位，不给伪精确单值。
 * - `items[0]` 是「最重要的一条」：`headline` 给列表条目一行，`detail` 给详情页与助手。
 * - `facets` 是机器语义的唯一来源（规则、周报、聚合读它），文案只是它的投影。
 *
 * 没有兼容形状：`confirmed` / `unconfirmed` / `coverage` / `mealInput` / 成分级结构
 * 一律不再存在。
 *
 * ## 领域纯度
 *
 * 校验走**手写判定**而不是 zod：`ddd-domain-purity` 禁止 import 任何外部包，
 * 而这份 schema 同时是 HTTP 契约（`schemas/meal-analysis.schema.ts` 由 zod 导出），
 * 所以 zod 版本留在那里供 OpenAPI 使用，这里的判定与它同语义、同上限。
 */

import {
  MEAL_ANALYSIS_FACET_LEVELS,
  MEAL_ANALYSIS_ITEM_KINDS,
} from './meal-facets.js';

export const MEAL_ANALYSIS_VERSION = 2;
export const MEAL_ANALYSIS_PROMPT_VERSION = 'meal-analysis.v2';

/** 分析的终态只有三个：进行中 / 已产出 / 失败（人工「确认」这一步已删除）。 */
export const MEAL_ANALYSIS_STATUSES = [
  'analyzing',
  'analyzed',
  'analysis_failed',
] as const;

/**
 * 稳定失败原因码（落库给客户端做 l10n，不再把英文原串直接抛给用户）。
 *
 * `job_lost` 与 `model_timeout` 的区别是**责任方**：前者是作业没能跑完就被丢了
 * （进程崩溃、队列丢单、Redis 数据被清，由过期回收器判定），后者是模型调用自己超时。
 * 两者对用户的补救动作一样（重试），但故障归因完全不同：混成一个码会让「模型超时」
 * 的告警淹没真实基础设施故障的时段。
 */
export const MEAL_ANALYSIS_FAILURE_REASONS = [
  'image_count_invalid',
  'vision_unavailable',
  'model_failed',
  'model_timeout',
  'job_lost',
  'invalid_output',
] as const;

export const MEAL_ANALYSIS_POLARITIES = ['good', 'watch', 'neutral'] as const;
export const MEAL_ANALYSIS_DISH_SOURCES = ['model', 'user'] as const;
export const MEAL_ANALYSIS_CALORIE_BUCKETS = ['low', 'medium', 'high'] as const;

/** 规范化上限。 */
export const MEAL_ANALYSIS_MAX_ITEMS = 5;
export const MEAL_ANALYSIS_MAX_DISHES = 20;
export const MEAL_ANALYSIS_HEADLINE_MAX_LENGTH = 18;
export const MEAL_ANALYSIS_DETAIL_MAX_LENGTH = 60;
export const MEAL_ANALYSIS_DISH_MAX_LENGTH = 40;
export const MEAL_ANALYSIS_CALORIE_MAX_KCAL = 5000;

/** 档位阈值（kcal）：中位值低于 low 记 low，低于 medium 记 medium，其余 high。 */
export const MEAL_ANALYSIS_CALORIE_BUCKET_THRESHOLDS = {
  low: 400,
  medium: 800,
} as const;

export type MealAnalysisStatus = (typeof MEAL_ANALYSIS_STATUSES)[number];
export type MealAnalysisFailureReason =
  (typeof MEAL_ANALYSIS_FAILURE_REASONS)[number];
export type MealAnalysisPolarity = (typeof MEAL_ANALYSIS_POLARITIES)[number];
export type MealAnalysisFacetLevel =
  (typeof MEAL_ANALYSIS_FACET_LEVELS)[number];
export type MealAnalysisCalorieBucket =
  (typeof MEAL_ANALYSIS_CALORIE_BUCKETS)[number];
export type MealAnalysisDishSource =
  (typeof MEAL_ANALYSIS_DISH_SOURCES)[number];

export interface MealAnalysisCalorieRange {
  min: number;
  max: number;
  unit: 'kcal';
  bucket: MealAnalysisCalorieBucket;
}

export interface MealAnalysisItem {
  rank: number;
  kind: string;
  polarity: MealAnalysisPolarity;
  headline: string;
  detail: string;
}

export interface MealAnalysisDish {
  name: string;
  source: MealAnalysisDishSource;
}

export type MealAnalysisFacets = Record<string, MealAnalysisFacetLevel>;

/** 落库形状（v2 完整对象）。 */
export interface MealAnalysisPayload {
  version: typeof MEAL_ANALYSIS_VERSION;
  analysisStatus: MealAnalysisStatus;
  analyzedAt: string | null;
  sourceRevision: number;
  model: string | null;
  promptVersion: string;
  locale: string | null;
  failureReason: MealAnalysisFailureReason | null;
  calorieRange: MealAnalysisCalorieRange | null;
  dishes: MealAnalysisDish[];
  items: MealAnalysisItem[];
  facets: MealAnalysisFacets;
}

/** 模型侧（或客户端）给出的原始结论，字段可信度低，必须过 [normalizeMealAnalysis]。 */
export interface MealAnalysisDraft {
  calorieRange?: { min?: unknown; max?: unknown } | null;
  dishes?: ReadonlyArray<{ name?: unknown; source?: unknown }> | null;
  items?: ReadonlyArray<{
    rank?: unknown;
    kind?: unknown;
    polarity?: unknown;
    headline?: unknown;
    detail?: unknown;
  }> | null;
  facets?: Record<string, unknown> | null;
}

export interface MealAnalysisEnvelope {
  sourceRevision: number;
  model: string | null;
  locale: string | null;
  analyzedAt?: string | null;
  promptVersion?: string;
}

/** 记录的 payload 外形：v2 起只有 `mealAnalysis` 一个键。 */
export interface MealRecordPayload {
  mealAnalysis?: MealAnalysisPayload | null;
}

type PlainRecord = Record<string, unknown>;

function asPlainRecord(raw: unknown): PlainRecord | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  return raw as PlainRecord;
}

function isOneOf<T extends string>(
  value: unknown,
  vocabulary: readonly T[],
): value is T {
  return typeof value === 'string' && vocabulary.includes(value as T);
}

/**
 * 契约校验（与 `schemas/meal-analysis.schema.ts` 的 zod 版本同语义）。
 *
 * 形状不匹配（旧记录、部分写入）一律返回 `false`：调用方按「没有分析」处理，
 * 而不是把半截对象交给读路径——消费方无法判断哪些字段可信，缺字段还会炸。
 */
export function isValidMealAnalysisPayload(
  raw: unknown,
): raw is MealAnalysisPayload {
  const payload = asPlainRecord(raw);
  if (payload == null) {
    return false;
  }

  if (payload['version'] !== MEAL_ANALYSIS_VERSION) return false;
  if (!isOneOf(payload['analysisStatus'], MEAL_ANALYSIS_STATUSES)) return false;
  if (
    payload['analyzedAt'] !== null &&
    typeof payload['analyzedAt'] !== 'string'
  )
    return false;
  if (
    typeof payload['sourceRevision'] !== 'number' ||
    !Number.isInteger(payload['sourceRevision']) ||
    payload['sourceRevision'] < 0
  ) {
    return false;
  }
  if (payload['model'] !== null && typeof payload['model'] !== 'string')
    return false;
  if (typeof payload['promptVersion'] !== 'string') return false;
  if (payload['locale'] !== null && typeof payload['locale'] !== 'string')
    return false;
  if (
    payload['failureReason'] !== null &&
    !isOneOf(payload['failureReason'], MEAL_ANALYSIS_FAILURE_REASONS)
  ) {
    return false;
  }

  const range = payload['calorieRange'];
  if (range !== null) {
    const record = asPlainRecord(range);
    if (record == null) return false;
    if (!isBoundedInteger(record['min'], 0, MEAL_ANALYSIS_CALORIE_MAX_KCAL))
      return false;
    if (!isBoundedInteger(record['max'], 0, MEAL_ANALYSIS_CALORIE_MAX_KCAL))
      return false;
    if (record['unit'] !== 'kcal') return false;
    if (!isOneOf(record['bucket'], MEAL_ANALYSIS_CALORIE_BUCKETS)) return false;
  }

  const dishes = payload['dishes'];
  if (!Array.isArray(dishes)) return false;
  for (const dish of dishes) {
    const record = asPlainRecord(dish);
    if (record == null) return false;
    if (!isBoundedString(record['name'], 1, MEAL_ANALYSIS_DISH_MAX_LENGTH))
      return false;
    if (!isOneOf(record['source'], MEAL_ANALYSIS_DISH_SOURCES)) return false;
  }

  const items = payload['items'];
  if (!Array.isArray(items)) return false;
  for (const item of items) {
    const record = asPlainRecord(item);
    if (record == null) return false;
    if (
      typeof record['rank'] !== 'number' ||
      !Number.isInteger(record['rank']) ||
      record['rank'] < 1
    ) {
      return false;
    }
    if (!isOneOf(record['kind'], MEAL_ANALYSIS_ITEM_KINDS)) return false;
    if (!isOneOf(record['polarity'], MEAL_ANALYSIS_POLARITIES)) return false;
    if (
      !isBoundedString(record['headline'], 1, MEAL_ANALYSIS_HEADLINE_MAX_LENGTH)
    ) {
      return false;
    }
    if (!isBoundedString(record['detail'], 1, MEAL_ANALYSIS_DETAIL_MAX_LENGTH))
      return false;
  }

  const facets = payload['facets'];
  if (facets !== undefined) {
    const record = asPlainRecord(facets);
    if (record == null) return false;
    for (const [key, level] of Object.entries(record)) {
      if (!isOneOf(key, MEAL_ANALYSIS_ITEM_KINDS)) return false;
      if (!isOneOf(level, MEAL_ANALYSIS_FACET_LEVELS)) return false;
    }
  }

  return true;
}

function isBoundedInteger(
  raw: unknown,
  min: number,
  max: number,
): raw is number {
  return (
    typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max
  );
}

function isBoundedString(
  raw: unknown,
  minLength: number,
  maxLength: number,
): raw is string {
  return (
    typeof raw === 'string' &&
    raw.length >= minLength &&
    raw.length <= maxLength
  );
}

/**
 * 解析记录的 payload。形状不匹配时返回 `{ mealAnalysis: null }`——**不抛错**：
 * 历史记录（v1）与部分写入在库里真实存在，读路径必须能继续工作。
 */
export function parseMealRecordPayload(raw: unknown): MealRecordPayload {
  const root = asPlainRecord(raw);
  if (root == null) {
    return {};
  }

  return {
    mealAnalysis: isValidMealAnalysisPayload(root['mealAnalysis'])
      ? root['mealAnalysis']
      : null,
  };
}

/**
 * 客户端可提交的唯一餐食字段是菜名列表：`{ mealAnalysis: { dishes: [{ name }] } }`。
 *
 * - 没有分析结果时没有可编辑的菜名，客户端提交被忽略（payload 保持为空）。
 * - 编辑后整份菜名列表都标记为 `user`（不保留逐条来源差异）。
 * - 改菜名**不重算** `items` / `calorieRange`，也不触发重新分析。
 */
export function buildMealPayloadFromClientInput(
  clientPayload: unknown,
  existingPayload: unknown,
): PlainRecord | null {
  const existing = parseMealRecordPayload(existingPayload).mealAnalysis ?? null;
  if (existing == null) {
    return null;
  }

  const clientAnalysis = asPlainRecord(
    asPlainRecord(clientPayload)?.['mealAnalysis'],
  );
  const submittedDishes = clientAnalysis?.['dishes'];
  if (!Array.isArray(submittedDishes)) {
    return { mealAnalysis: existing };
  }

  const dishes = normalizeMealAnalysisDishes(
    submittedDishes.map((dish) => ({
      name: asPlainRecord(dish)?.['name'],
      source: 'user' as const,
    })),
  );

  return { mealAnalysis: { ...existing, dishes } };
}

/** 入队占位：状态置 `analyzing` 并把 `sourceRevision` 递增（幂等靠它）。 */
export function markMealAnalysisQueued(rawPayload: unknown): PlainRecord {
  const previous = parseMealRecordPayload(rawPayload).mealAnalysis ?? null;

  return {
    mealAnalysis: buildAnalyzingMealAnalysis({
      sourceRevision: (previous?.sourceRevision ?? 0) + 1,
    }),
  };
}

/** payload 里的当前 revision（没有payload / 没有分析时为 0）。 */
export function getMealSourceRevision(rawPayload: unknown): number {
  return parseMealRecordPayload(rawPayload).mealAnalysis?.sourceRevision ?? 0;
}

/** 推导热量档位：不信任模型给的 bucket。 */
export function calorieBucketFor(
  min: number,
  max: number,
): MealAnalysisCalorieBucket {
  const midpoint = (min + max) / 2;
  if (midpoint < MEAL_ANALYSIS_CALORIE_BUCKET_THRESHOLDS.low) return 'low';
  if (midpoint < MEAL_ANALYSIS_CALORIE_BUCKET_THRESHOLDS.medium) {
    return 'medium';
  }
  return 'high';
}

/** 纠正区间：非数值丢弃、`min<=max`、clamp 到上限、取整。非法时返回 null。 */
export function normalizeCalorieRange(
  range: MealAnalysisDraft['calorieRange'],
): MealAnalysisCalorieRange | null {
  const rawMin = range?.min;
  const rawMax = range?.max;
  if (typeof rawMin !== 'number' || typeof rawMax !== 'number') return null;
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return null;

  const clamp = (value: number) =>
    Math.min(Math.max(Math.round(value), 0), MEAL_ANALYSIS_CALORIE_MAX_KCAL);
  const min = clamp(Math.min(rawMin, rawMax));
  const max = clamp(Math.max(rawMin, rawMax));
  return { min, max, unit: 'kcal', bucket: calorieBucketFor(min, max) };
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 截断到上限：模型超长时保留信息，而不是整条丢弃。 */
function truncated(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength).trim() : value;
}

/** 规范化结论：丢空、非法枚举回落、按 rank 重排重编号、条数封顶。 */
export function normalizeMealAnalysisItems(
  drafts: MealAnalysisDraft['items'],
): MealAnalysisItem[] {
  const candidates = (drafts ?? [])
    .map((draft, index) => {
      const headline = trimmed(draft.headline);
      const detail = trimmed(draft.detail);
      if (headline.length === 0 || detail.length === 0) return null;
      const rank = Number(draft.rank);
      return {
        order:
          Number.isFinite(rank) && rank > 0 ? rank : Number.MAX_SAFE_INTEGER,
        index,
        kind: isOneOf(draft.kind, MEAL_ANALYSIS_ITEM_KINDS)
          ? draft.kind
          : 'other',
        polarity: isOneOf(draft.polarity, MEAL_ANALYSIS_POLARITIES)
          ? draft.polarity
          : ('neutral' as const),
        headline: truncated(headline, MEAL_ANALYSIS_HEADLINE_MAX_LENGTH),
        detail: truncated(detail, MEAL_ANALYSIS_DETAIL_MAX_LENGTH),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .slice(0, MEAL_ANALYSIS_MAX_ITEMS);

  return candidates.map((item, index) => ({
    rank: index + 1,
    kind: item.kind,
    polarity: item.polarity,
    headline: item.headline,
    detail: item.detail,
  }));
}

/** 规范化菜名：去空、按名去重（大小写不敏感）、封顶；`source` 非法一律按模型识别。 */
export function normalizeMealAnalysisDishes(
  drafts: MealAnalysisDraft['dishes'],
): MealAnalysisDish[] {
  const seen = new Set<string>();
  const dishes: MealAnalysisDish[] = [];
  for (const draft of drafts ?? []) {
    const name = truncated(trimmed(draft.name), MEAL_ANALYSIS_DISH_MAX_LENGTH);
    if (name.length === 0) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dishes.push({
      name,
      source: draft.source === 'user' ? 'user' : 'model',
    });
    if (dishes.length >= MEAL_ANALYSIS_MAX_DISHES) break;
  }
  return dishes;
}

/** 只保留封闭词表里的键与档位。 */
export function normalizeMealAnalysisFacets(
  facets: MealAnalysisDraft['facets'],
): MealAnalysisFacets {
  const normalized: MealAnalysisFacets = {};
  for (const [key, value] of Object.entries(facets ?? {})) {
    if (!isOneOf(key, MEAL_ANALYSIS_ITEM_KINDS)) continue;
    if (!isOneOf(value, MEAL_ANALYSIS_FACET_LEVELS)) continue;
    normalized[key] = value;
  }
  return normalized;
}

/** 模型输出 → 落库形状（成功路径）。 */
export function normalizeMealAnalysis(
  draft: MealAnalysisDraft,
  envelope: MealAnalysisEnvelope,
): MealAnalysisPayload {
  return {
    version: MEAL_ANALYSIS_VERSION,
    analysisStatus: 'analyzed',
    analyzedAt: envelope.analyzedAt ?? null,
    sourceRevision: envelope.sourceRevision,
    model: envelope.model,
    promptVersion: envelope.promptVersion ?? MEAL_ANALYSIS_PROMPT_VERSION,
    locale: envelope.locale,
    failureReason: null,
    calorieRange: normalizeCalorieRange(draft.calorieRange),
    dishes: normalizeMealAnalysisDishes(draft.dishes),
    items: normalizeMealAnalysisItems(draft.items),
    facets: normalizeMealAnalysisFacets(draft.facets),
  };
}

/** 入队时占位（v1 的 `unconfirmed`/`coverage` 占位语义由这一条取代）。 */
export function buildAnalyzingMealAnalysis(
  envelope: Pick<MealAnalysisEnvelope, 'sourceRevision'>,
): MealAnalysisPayload {
  return {
    version: MEAL_ANALYSIS_VERSION,
    analysisStatus: 'analyzing',
    analyzedAt: null,
    sourceRevision: envelope.sourceRevision,
    model: null,
    promptVersion: MEAL_ANALYSIS_PROMPT_VERSION,
    locale: null,
    failureReason: null,
    calorieRange: null,
    dishes: [],
    items: [],
    facets: {},
  };
}

/** 失败终态：原因码落库，客户端据此做 l10n。 */
export function buildFailedMealAnalysis(
  reason: MealAnalysisFailureReason,
  envelope: MealAnalysisEnvelope,
): MealAnalysisPayload {
  return {
    version: MEAL_ANALYSIS_VERSION,
    analysisStatus: 'analysis_failed',
    analyzedAt: envelope.analyzedAt ?? null,
    sourceRevision: envelope.sourceRevision,
    model: envelope.model,
    promptVersion: envelope.promptVersion ?? MEAL_ANALYSIS_PROMPT_VERSION,
    locale: envelope.locale,
    failureReason: reason,
    calorieRange: null,
    dishes: [],
    items: [],
    facets: {},
  };
}

/** 列表条目一行的文案：最重要的一条；没有结论时返回 null（条目只显示区间）。 */
export function mealAnalysisHeadline(
  payload: MealAnalysisPayload | null | undefined,
): string | null {
  return payload?.items[0]?.headline ?? null;
}

/** 写入记录的餐食分析投影列；读路径（列表、报告、助手）只认这些列。 */
export interface MealAnalysisColumns {
  mealAnalysisStatus: MealAnalysisStatus | null;
  mealAnalysisUpdatedAt: Date | null;
  mealAnalysisFailureReason: MealAnalysisFailureReason | null;
  /** 最重要的一条结论，列表条目那一行。 */
  mealHeadline: string | null;
  mealCalorieMin: number | null;
  mealCalorieMax: number | null;
  mealCalorieBucket: MealAnalysisCalorieBucket | null;
  mealSourceRevision: number;
}

export function toMealAnalysisColumns(
  analysis: MealAnalysisPayload | null,
): MealAnalysisColumns {
  const range = analysis?.calorieRange ?? null;

  return {
    mealAnalysisStatus: analysis?.analysisStatus ?? null,
    mealAnalysisUpdatedAt:
      analysis?.analyzedAt != null ? new Date(analysis.analyzedAt) : null,
    mealAnalysisFailureReason: analysis?.failureReason ?? null,
    mealHeadline: mealAnalysisHeadline(analysis),
    mealCalorieMin: range?.min ?? null,
    mealCalorieMax: range?.max ?? null,
    mealCalorieBucket: range?.bucket ?? null,
    mealSourceRevision: analysis?.sourceRevision ?? 0,
  };
}
