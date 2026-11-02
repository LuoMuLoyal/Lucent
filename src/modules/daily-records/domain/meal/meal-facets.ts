/**
 * 结论的封闭词表（facet 维度）。
 *
 * 为什么单独一个文件：这份词表是**跨上下文发布语言**的一部分——today-suggestion
 * 的 ACL 只认识其中 9 个维度（`balance` / `other` 不进信号），shared 的
 * `diet-facet-mirror` 检查会把它与下游的词表对账。放在这里让词表可以被单独引用，
 * 不必把整个分析契约拖进来。
 */

/** 机器维度的封闭词表：自由发挥会让下游无法使用。 */
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

export type MealAnalysisItemKind = (typeof MEAL_ANALYSIS_ITEM_KINDS)[number];

/** 档位词表（注意：与 `itemKind` 是两个不同的轴）。 */
export const MEAL_ANALYSIS_FACET_LEVELS = ['low', 'ok', 'high'] as const;

export type MealAnalysisFacetLevel =
  (typeof MEAL_ANALYSIS_FACET_LEVELS)[number];
