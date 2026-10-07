import { z } from 'zod';
import { ASSISTANT_TOOL_NAMES } from '../tools/shared/tool-types.js';

/**
 * 单轮最多绑定几个工具。
 *
 * 与旧关键词表的行为对齐：它命中的工具集通常是个位数（实测最多 5 个）。
 * 给模型一个上界，是为了避免"把 20 多个工具全绑上"变成常态——那等于取消了
 * 预筛选这一层（成本、误调用双升），而降级路径的"工具全开"是显式例外。
 */
export const ASSISTANT_TOOL_SELECTION_MAX = 8;

/**
 * 路由模型的**结构化输出**：只出"这轮需要哪些工具"。
 *
 * ⚠️ 刻意**不**让模型同时出 `intent`：intent 由 `deriveIntent()` 从工具集确定性导出
 * （`agent/runtime/classify.ts`）。两处各算一份的话，`relevantTools` 与 `intent`
 * 可以互相矛盾——旧实现的 intent 分桶与工具筛选就是两条独立规则，本次事故里
 * 正是这种"看着都对、合起来不对"的组合最难查。
 *
 * `reason` 只进日志与评测集，不参与任何决策。
 */
export const assistantToolSelectionSchema = z.object({
  tools: z
    .array(z.enum(ASSISTANT_TOOL_NAMES))
    .max(ASSISTANT_TOOL_SELECTION_MAX)
    .describe(
      'The tools this turn needs, most relevant first. Return an empty array when the message needs no tool at all.',
    ),
  reason: z
    .string()
    .max(200)
    .optional()
    .describe('One-line justification, for logs and evaluation only.'),
});

export type AssistantToolSelectionOutput = z.infer<
  typeof assistantToolSelectionSchema
>;
