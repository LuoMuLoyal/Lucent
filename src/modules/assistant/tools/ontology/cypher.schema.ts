import { z } from 'zod';

/**
 * 模型产出的 Cypher 查询。
 *
 * `params` 与 `rationale` 是可选的，但**参数化不是可选项**：把值写进查询文本
 * 会让模型输出直接进入语句（注入面），所以 system prompt 要求所有字面量走
 * `params` / `$name`，这里只是承接。
 */
export const ontologyCypherSchema = z.object({
  cypher: z.string().trim().min(1).max(4000),
  params: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
  rationale: z.string().trim().max(300).optional(),
});

export type OntologyCypherOutput = z.infer<typeof ontologyCypherSchema>;

/** 生成 + 纠错重试所需的上下文。 */
export interface OntologyCypherContext {
  /** 用户问题（英文侧图谱，问题可能是中文——那只是措辞，实体名保持英文）。 */
  question: string;
  /** 图上真实存在的标签与关系类型（来自 sidecar `GET /schema`）。 */
  schema: {
    graph: string;
    nodeCount: number;
    relationshipCount: number;
    labels: readonly { label: string; count: number }[];
    relationshipTypes: readonly { label: string; count: number }[];
  };
  /** 上一次被拒绝的查询与原因（首次生成为 null）。 */
  previousCypher: string | null;
  previousErrorKind: string | null;
  previousError: string | null;
  /** 第几次尝试，从 1 开始。 */
  attempt: number;
}
