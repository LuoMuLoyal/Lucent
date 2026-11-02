import { z } from 'zod';

/**
 * `GET /medicines/medication-overview` 的响应契约。
 *
 * ## 为什么没有「风险等级」字段
 *
 * 这个端点描述的是**现状**（同一成分几份、药理上交汇在哪），不是判定。
 * 判级是 `/risk-check` 的职责，两者混在一个响应里会让客户端分不清
 * 「这是风险结论」还是「这是结构化事实」。
 */

export const duplicateIngredientGroupSchema = z.object({
  ingredientKey: z
    .string()
    .describe('Shared ingredient key that made these entries duplicates.'),
  entryIds: z
    .array(z.string())
    .describe('Ids of the current-medicine entries involved.'),
  displayNames: z.array(z.string()).describe('Display names of those entries.'),
  severity: z
    .enum(['medium', 'high'])
    .describe(
      'high when three or more entries share the ingredient, or when they span two knowledge sources.',
    ),
});

export const sourceOverlapSchema = z.object({
  source: z
    .string()
    .describe(
      'Health event id, or "unattributed" when no event links the medicine.',
    ),
  medicineCount: z
    .number()
    .int()
    .describe('How many entries this medicine group holds.'),
  displayNames: z.array(z.string()).describe('Display names in this group.'),
});

export const medicationOverviewResponseSchema = z.object({
  totalMedicines: z
    .number()
    .int()
    .describe('Every current medicine on record.'),
  resolvableMedicines: z
    .number()
    .int()
    .describe(
      'How many could be resolved to ingredients. The rest cannot participate in duplicate detection.',
    ),
  duplicates: z
    .array(duplicateIngredientGroupSchema)
    .describe('One entry per shared ingredient; empty when nothing overlaps.'),
  sourceOverlaps: z
    .array(sourceOverlapSchema)
    .describe('Entries grouped by health event, plus unattributed ones.'),
});

export type MedicationOverviewResponse = z.infer<
  typeof medicationOverviewResponseSchema
>;
