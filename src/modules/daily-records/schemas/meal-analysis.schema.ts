import { z } from 'zod';

/**
 * 餐食分析契约 v2。
 *
 * 为什么换掉 v1：v1 走「视觉识别菜品 → 菜品分解 → 成分接地对照食物成分表 → 算热量」，
 * 实测在真实照片上行不通（误差逐段放大成没有意义的数字，且要维护一张覆盖真实饮食的
 * 成分表）。v2 改为**一次多模态分析直出**：热量区间 + 按重要性排序的结论 + 收敛的机器词表。
 *
 * 三条不变量：
 * - `calorieRange` 是独立字段，**不参与 `items` 排序**；只给区间与档位，不给伪精确单值。
 * - `items[0]` 是「最重要的一条」：`headline` 给列表条目一行，`detail` 给详情页与助手。
 * - `facets` 是机器语义的唯一来源（规则、周报、聚合读它），文案只是它的投影。
 *
 * 没有兼容形状：`confirmed` / `unconfirmed` / `coverage` / `mealInput` / 成分级结构一律不再存在。
 */

export const MEAL_ANALYSIS_VERSION = 2;
export const MEAL_ANALYSIS_PROMPT_VERSION = 'meal-analysis.v2';

/** 分析的终态只有三个：进行中 / 已产出 / 失败（人工「确认」这一步已删除）。 */
export const MEAL_ANALYSIS_STATUSES = [
  'analyzing',
  'analyzed',
  'analysis_failed',
] as const;

/** 稳定失败原因码（落库给客户端做 l10n，不再把英文原串直接抛给用户）。 */
export const MEAL_ANALYSIS_FAILURE_REASONS = [
  'image_count_invalid',
  'vision_unavailable',
  'model_failed',
  'model_timeout',
  'invalid_output',
] as const;

/** 结论的封闭词表：自由发挥会让下游无法使用。 */
export const MEAL_ANALYSIS_ITEM_KINDS = [
  'carb',
  'fat',
  'protein',
  'vegetable',
  'fruit',
  'fried',
  'sugar',
  'sodium',
  'portion',
  'balance',
  'other',
] as const;

export const MEAL_ANALYSIS_POLARITIES = ['good', 'watch', 'neutral'] as const;
export const MEAL_ANALYSIS_FACET_LEVELS = ['low', 'ok', 'high'] as const;
export const MEAL_ANALYSIS_DISH_SOURCES = ['model', 'user'] as const;
export const MEAL_ANALYSIS_CALORIE_BUCKETS = ['low', 'medium', 'high'] as const;

/** 规范化上限。 */
export const MEAL_ANALYSIS_MAX_ITEMS = 5;
export const MEAL_ANALYSIS_MAX_DISHES = 20;
export const MEAL_ANALYSIS_HEADLINE_MAX_LENGTH = 18;
export const MEAL_ANALYSIS_DETAIL_MAX_LENGTH = 60;
export const MEAL_ANALYSIS_DISH_MAX_LENGTH = 40;
export const MEAL_ANALYSIS_CALORIE_MAX_KCAL = 5000;

/** 档位阈值（kcal）：低于 low 记 low，低于 medium 记 medium，其余 high。 */
export const MEAL_ANALYSIS_CALORIE_BUCKET_THRESHOLDS = {
  low: 400,
  medium: 800,
} as const;

const itemKindSchema = z.enum(MEAL_ANALYSIS_ITEM_KINDS);
const itemPolaritySchema = z.enum(MEAL_ANALYSIS_POLARITIES);
const facetLevelSchema = z.enum(MEAL_ANALYSIS_FACET_LEVELS);

export const mealAnalysisItemSchema = z.object({
  rank: z.number().int().positive(),
  kind: itemKindSchema,
  polarity: itemPolaritySchema,
  headline: z.string().min(1).max(MEAL_ANALYSIS_HEADLINE_MAX_LENGTH),
  detail: z.string().min(1).max(MEAL_ANALYSIS_DETAIL_MAX_LENGTH),
});

export const mealAnalysisCalorieRangeSchema = z.object({
  min: z.number().int().nonnegative().max(MEAL_ANALYSIS_CALORIE_MAX_KCAL),
  max: z.number().int().nonnegative().max(MEAL_ANALYSIS_CALORIE_MAX_KCAL),
  unit: z.literal('kcal'),
  bucket: z.enum(MEAL_ANALYSIS_CALORIE_BUCKETS),
});

export const mealAnalysisDishSchema = z.object({
  name: z.string().min(1).max(MEAL_ANALYSIS_DISH_MAX_LENGTH),
  source: z.enum(MEAL_ANALYSIS_DISH_SOURCES),
});

export const mealAnalysisPayloadSchema = z.object({
  version: z.literal(MEAL_ANALYSIS_VERSION),
  analysisStatus: z.enum(MEAL_ANALYSIS_STATUSES),
  analyzedAt: z.string().nullable(),
  sourceRevision: z.number().int().nonnegative(),
  model: z.string().nullable(),
  promptVersion: z.string(),
  locale: z.string().nullable(),
  failureReason: z.enum(MEAL_ANALYSIS_FAILURE_REASONS).nullable(),
  calorieRange: mealAnalysisCalorieRangeSchema.nullable(),
  dishes: z.array(mealAnalysisDishSchema),
  items: z.array(mealAnalysisItemSchema),
  facets: z.partialRecord(itemKindSchema, facetLevelSchema),
});

export type MealAnalysisStatus = (typeof MEAL_ANALYSIS_STATUSES)[number];
export type MealAnalysisFailureReason =
  (typeof MEAL_ANALYSIS_FAILURE_REASONS)[number];
export type MealAnalysisItemKind = (typeof MEAL_ANALYSIS_ITEM_KINDS)[number];
export type MealAnalysisPolarity = (typeof MEAL_ANALYSIS_POLARITIES)[number];
export type MealAnalysisFacetLevel =
  (typeof MEAL_ANALYSIS_FACET_LEVELS)[number];
export type MealAnalysisCalorieBucket =
  (typeof MEAL_ANALYSIS_CALORIE_BUCKETS)[number];
export type MealAnalysisCalorieRange = z.infer<
  typeof mealAnalysisCalorieRangeSchema
>;
export type MealAnalysisItem = z.infer<typeof mealAnalysisItemSchema>;
export type MealAnalysisDish = z.infer<typeof mealAnalysisDishSchema>;
export type MealAnalysisPayload = z.infer<typeof mealAnalysisPayloadSchema>;

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

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

/** 纠正区间：非有限值丢弃、`min<=max`、clamp 到上限、取整。非法时返回 null。 */
export function normalizeCalorieRange(
  range: MealAnalysisDraft['calorieRange'],
): MealAnalysisCalorieRange | null {
  const rawMin = Number(range?.min);
  const rawMax = Number(range?.max);
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return null;

  const clamp = (value: number) =>
    Math.min(Math.max(Math.round(value), 0), MEAL_ANALYSIS_CALORIE_MAX_KCAL);
  const min = clamp(Math.min(rawMin, rawMax));
  const max = clamp(Math.max(rawMin, rawMax));
  return { min, max, unit: 'kcal', bucket: calorieBucketFor(min, max) };
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
        kind: itemKindSchema.safeParse(draft.kind).success
          ? (draft.kind as MealAnalysisItemKind)
          : ('other' as const),
        polarity: itemPolaritySchema.safeParse(draft.polarity).success
          ? (draft.polarity as MealAnalysisPolarity)
          : ('neutral' as const),
        headline,
        detail,
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
    const name = trimmed(draft.name);
    if (name.length === 0 || name.length > MEAL_ANALYSIS_DISH_MAX_LENGTH) {
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
): Partial<Record<MealAnalysisItemKind, MealAnalysisFacetLevel>> {
  const normalized: Partial<
    Record<MealAnalysisItemKind, MealAnalysisFacetLevel>
  > = {};
  for (const [key, value] of Object.entries(facets ?? {})) {
    const kind = itemKindSchema.safeParse(key);
    const level = facetLevelSchema.safeParse(value);
    if (kind.success && level.success) {
      normalized[kind.data] = level.data;
    }
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
