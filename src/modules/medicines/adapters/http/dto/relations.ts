import { z } from 'zod';

/**
 * 图查询端点的 HTTP 契约。
 *
 * ## 入参只有业务标识
 *
 * 所有查询都只收 DrugBank id / 基因名 / 药物 id，**没有**任何接受 Cypher 或
 * GraphQL 的字段。这是刻意的：图查询能力只在服务端内部存在（见
 * `infrastructure/graph/executor.ts`），客户端只能决定「查什么药」。
 *
 * `.strict()` 沿用本模块其它查询 DTO 的姿态：未知参数直接拒绝，
 * 避免「拼错了参数名但请求仍然 200」这种最难发现的错误。
 */

/**
 * 多药查询的药数下限：一个药之间不存在「两两关系」。
 */
const MIN_MULTI_DRUG_IDS = 2;

/**
 * 多药查询的药数上限。
 *
 * 与 `Neo4jGraphReader` 的截断阈值一致：这里**拒绝**（给客户端明确错误），
 * reader 层**截断**（兜底其它调用方）。上限存在的理由是笛卡尔积——
 * `INHIBITS` × `SUBSTRATE_OF` 的组合数随药数平方增长。
 */
const MAX_MULTI_DRUG_IDS = 10;

/** DrugBank id 的形态：`DB` + 5 位数字。形态校验能挡掉大部分误传的商品名。 */
const drugbankIdSchema = z
  .string()
  .regex(/^DB\d{5}$/, 'validation.field.invalid')
  .describe('DrugBank id, e.g. DB00682');

/**
 * 基因符号长度上限。最长的人类基因符号约 20 字符（如 `CYP2C9`）；
 * 留到 32 是为其他物种与别名留余量，不是精确边界。
 */
const MAX_GENE_SYMBOL_LENGTH = 32;

/** 基因符号。图上 `Protein.gene_name` 的取值，如 `CYP2C9`。 */
const geneSymbolSchema = z
  .string()
  .trim()
  .min(1, 'validation.field.required')
  .max(MAX_GENE_SYMBOL_LENGTH, 'validation.field.too_long')
  .regex(/^[A-Za-z0-9-]+$/, 'validation.field.invalid')
  .describe('Gene symbol, e.g. CYP2C9');

/**
 * 多药查询的入参。
 *
 * 上限 10 与 `Neo4jGraphReader.MAX_DRUG_IDS` 一致；两处都在，是因为
 * HTTP 层要**拒绝**超限（给客户端明确错误），而 reader 层要**兜底**截断
 * （防止其它调用方绕过 HTTP 直接调 reader）。
 */
export const multiDrugQuerySchema = z
  .object({
    drugbankIds: z
      .string()
      .describe('Comma-separated DrugBank ids (2-10), e.g. DB00682,DB00004')
      .transform((raw) =>
        raw
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      )
      .pipe(
        z
          .array(drugbankIdSchema)
          .min(MIN_MULTI_DRUG_IDS)
          .max(MAX_MULTI_DRUG_IDS),
      ),
  })
  .strict();

export type MultiDrugQueryDto = z.infer<typeof multiDrugQuerySchema>;

export const singleDrugQuerySchema = z
  .object({
    drugbankId: drugbankIdSchema,
  })
  .strict();

export type SingleDrugQueryDto = z.infer<typeof singleDrugQuerySchema>;

export const substituteQuerySchema = z
  .object({
    drugbankId: drugbankIdSchema,
    enzymeGene: geneSymbolSchema,
  })
  .strict();

export type SubstituteQueryDto = z.infer<typeof substituteQuerySchema>;

export const targetQuerySchema = z
  .object({
    geneName: geneSymbolSchema,
  })
  .strict();

export type TargetQueryDto = z.infer<typeof targetQuerySchema>;

export const routeQuerySchema = z
  .object({
    fromDrugbankId: drugbankIdSchema,
    toDrugbankId: drugbankIdSchema,
  })
  .strict();

export type RouteQueryDto = z.infer<typeof routeQuerySchema>;

// ── 响应 schema ────────────────────────────────────────────────
// 出站校验不做 `.strict()`：只声明会出网的字段，多出的字段不会泄漏到响应。

export const mechanismPathSchema = z.object({
  enzymeGene: z.string().describe('Metabolising enzyme gene symbol.'),
  enzymeName: z.string().describe('Enzyme display name.'),
  otherDrugId: z.string().describe('Other drug DrugBank id.'),
  otherDrugName: z.string().describe('Other drug display name.'),
  relation: z
    .string()
    .describe('What the first drug does to the enzyme (INHIBITS/INDUCES).'),
});

export const sharedTargetSchema = z.object({
  targetGene: z.string().describe('Shared target gene symbol.'),
  targetName: z.string().describe('Shared target display name.'),
  drugCount: z
    .number()
    .int()
    .describe('How many of the queried drugs hit this target.'),
  drugIds: z.array(z.string()).describe('DrugBank ids hitting this target.'),
  drugNames: z.array(z.string()).describe('Display names hitting this target.'),
});

export const cascadePathSchema = z.object({
  startDrug: z.string().describe('Starting drug name.'),
  enzymeOne: z.string().describe('First enzyme in the chain.'),
  middleDrug: z.string().describe('Drug occupying the middle of the chain.'),
  enzymeTwo: z.string().describe('Second enzyme in the chain.'),
  endDrug: z.string().describe('Drug whose exposure is affected downstream.'),
});

export const substituteCandidateSchema = z.object({
  drugbankId: z.string().describe('Candidate DrugBank id.'),
  name: z.string().describe('Candidate display name.'),
  sharedTarget: z
    .string()
    .nullable()
    .describe(
      'Target shared with the source drug (the structural reason for candidacy).',
    ),
});

export const drugActionSchema = z.object({
  targetGene: z.string().describe('Target gene symbol.'),
  targetName: z.string().describe('Target display name.'),
  relation: z
    .string()
    .describe('Relation type (INHIBITS/INDUCES/ACTS_ON/SUBSTRATE_OF).'),
  actions: z
    .array(z.string())
    .describe('Action labels on the edge, when present.'),
});

export const shortestRouteSchema = z.object({
  stepCount: z.number().int().describe('Number of hops in the path.'),
  pathNodes: z.array(z.string()).describe('Node display names, in path order.'),
  pathRelations: z
    .array(z.string())
    .describe('Edge types, aligned with pathNodes.'),
});

export const targetDrugSchema = z.object({
  drugbankId: z
    .string()
    .describe('DrugBank id of a drug acting on the target.'),
  name: z.string().describe('Drug display name.'),
  relation: z.string().describe('Relation type to the target.'),
});

export const transportRouteSchema = z.object({
  transporterGene: z.string().describe('Transporter gene symbol.'),
  transporterName: z.string().describe('Transporter display name.'),
  inverted: z
    .boolean()
    .describe(
      'True when the edge points transporter -> drug (do not draw a same-direction arrow).',
    ),
});

export const enzymeDuelSchema = z.object({
  enzymeGene: z
    .string()
    .describe('Enzyme where induction and metabolism meet.'),
  inducerDrug: z
    .string()
    .describe('Drug inducing the enzyme (lowers substrate exposure).'),
  inhibitedSubstrate: z
    .string()
    .describe('Substrate drug whose exposure falls.'),
});

/**
 * 统一的结果信封。
 *
 * ## `status` 为什么有三态
 *
 * `ok` 表示「查到了（可能是空数组）」，`unavailable` / `timeout` /
 * `notConfigured` 表示「我们无法回答」。把后者压成空数组，会让界面把
 * 知识缺口显示成「没有风险」——在用药场景里这是最危险的静默降级。
 */
export const graphQueryStatusSchema = z.enum([
  'ok',
  'notConfigured',
  'unavailable',
  'timeout',
]);

export type GraphQueryStatus = z.infer<typeof graphQueryStatusSchema>;
