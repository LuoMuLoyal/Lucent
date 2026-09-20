import { z } from 'zod';
import type { SemanticaErrorKind } from './semantica.types.js';

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
  /**
   * 上一次的拒绝类别，决定 RETRY_HINTS 里给哪一句纠正方向。
   *
   * 取值的三处来源都是封闭集合：sidecar 的结构化 kind（`/query` 与 `/reason`
   * 各自的词表）、本层的客户端侧信号 `missing_provenance`。写成 `string` 会让
   * 拼错或改名在编译期溜过去，而它的唯一用途就是查表——查不到就静默降级成
   * 一句通用提示，正好抹掉"为什么重试"这个信息。
   */
  previousErrorKind: SemanticaErrorKind | 'missing_provenance' | null;
  previousError: string | null;
  /** 第几次尝试，从 1 开始。 */
  attempt: number;
}
