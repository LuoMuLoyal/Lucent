/**
 * 单药邻域图的响应体（`GET /medicines/:id/network`）。
 *
 * zod 4 Standard Schema：契约的唯一事实源在代码里，OpenAPI 由
 * `pnpm export:openapi` 生成，Flutter 与 Lumine 客户端都从它派生类型。
 *
 * ## 为什么 `truncated` 与 `ordering` 是必填
 *
 * 它们不是可选的展示提示，而是**这张图是否诚实的声明**：
 *
 * - `truncated > 0` 时界面必须显示「还有 N 个未显示」，否则用户会把
 *   30 个邻居当成全部（`DB00176` 真实度数是 2,249）；
 * - `ordering` 说明选择依据是 id 字典序而非重要性，界面据此如实标注，
 *   而不是暗示「这是最重要的 30 个」。
 *
 * 缺了任何一个，前端就只能猜——所以两者都不给默认值。
 */

import { z } from 'zod';

import {
  DEFAULT_NEIGHBOUR_LIMIT,
  MAX_NEIGHBOUR_LIMIT,
  NETWORK_EDGE_KINDS,
  NETWORK_ORDERINGS,
  SUPPORTED_NETWORK_DEPTHS,
} from '../../../domain/relations/network.js';

/** `GET /medicines/:id/network` 的查询参数。 */
export const medicineNetworkQuerySchema = z
  .object({
    source: z
      .string()
      .describe(
        'Knowledge source selector. Only drugbank has a relation graph.',
      )
      .meta({ example: 'drugbank' })
      .optional(),
    depth: z
      .enum(SUPPORTED_NETWORK_DEPTHS.map(String))
      .default('1')
      .describe(
        'Neighbourhood depth. Only 1 is supported: on the interaction graph depth 2 is quadratic (a 2,249-degree hub expands to millions of edges) and unreadable.',
      ),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_NEIGHBOUR_LIMIT)
      .default(DEFAULT_NEIGHBOUR_LIMIT)
      .describe(
        `Maximum neighbour nodes in total (1-${String(MAX_NEIGHBOUR_LIMIT)}), not per category. Targets are placed first (sparse, high information density), interaction partners fill the remainder. The selection is deterministic but not ranked by importance.`,
      ),
  })
  .strict();

/** Strongly typed query of `GET /medicines/:id/network`. */
export type MedicineNetworkQueryDto = z.infer<
  typeof medicineNetworkQuerySchema
>;

const networkDegreeSchema = z.object({
  interactions: z
    .number()
    .int()
    .describe(
      'Total interacting drugs, from count(*), not the truncated list length.',
    ),
  targets: z
    .number()
    .int()
    .describe('Total drug-target edges of the centre drug.'),
});

const networkNeighbourSchema = z.object({
  id: z
    .string()
    .describe('Entity id: DrugBank id for drugs, target id for proteins.'),
  name: z.string().describe('Display name.'),
  nodeKind: z
    .enum(['drug', 'protein'])
    .describe('Node type, used for shape and legend grouping.'),
  inCatalogue: z
    .boolean()
    .describe(
      'Whether the neighbour exists in the local catalogue. Interaction partners may have been retired upstream, so out-of-catalogue nodes are name-only and must not be linked.',
    ),
});

const networkEdgeSchema = z.object({
  kind: z.enum(NETWORK_EDGE_KINDS).describe('Which fact this edge states.'),
  neighbourId: z
    .string()
    .describe('Matches the neighbour id this edge ends at.'),
  relationKind: z
    .string()
    .nullable()
    .describe(
      'Target-edge relation kind (target / enzyme / carrier / transporter).',
    ),
  actions: z
    .array(z.string())
    .describe('Target-edge action labels (inhibitor, agonist, ...).'),
});

export const medicineNetworkSchema = z.object({
  center: z.object({
    id: z.string().describe('DrugBank id of the centre drug.'),
    name: z.string().describe('Display name of the centre drug.'),
  }),
  degree: networkDegreeSchema,
  neighbours: z
    .array(networkNeighbourSchema)
    .describe(
      'At most `limit` neighbours; complete only when `truncated` is 0.',
    ),
  edges: z
    .array(networkEdgeSchema)
    .describe(
      'One edge per neighbour, always from the centre outward. Facts only.',
    ),
  truncated: z
    .number()
    .int()
    .describe(
      'Neighbours omitted by the limit. Non-zero means the UI must say "and N more"; treating the list as complete would misstate the drug’s degree.',
    ),
  ordering: z
    .enum(NETWORK_ORDERINGS)
    .describe(
      'How the shown neighbours were chosen. drugbank_id_asc means deterministic index order, NOT ranked by importance.',
    ),
});

/** Strongly typed body of `GET /medicines/:id/network`. */
export type MedicineNetworkDto = z.infer<typeof medicineNetworkSchema>;
