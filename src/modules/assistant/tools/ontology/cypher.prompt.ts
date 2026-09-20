import type { OntologyCypherContext } from './cypher.schema.js';

/**
 * 英文侧 OAG 的 NL→Cypher 提示词。
 *
 * 归属（计划 §3.5 ②）：生成留在 Lucent（复用 `LlmRuntimeService` 的角色化配置、
 * 一套凭据/成本/限流），sidecar 只做校验 + 执行。因此**规则必须与 sidecar 的
 * 守卫对齐**：这里的每条硬规则，`semantica-service` 的 `/query` 都会强制，
 * 违反时返回结构化的 `kind`，由重试回路回喂给模型自纠。
 */

/** 每个 schema/关系类型在 prompt 里最多列出的条数：全量列会把 prompt 撑爆。 */
const MAX_TYPES_IN_PROMPT = 60;

/** AGE 1.7 的硬限制（试点实测，计划 §6.3）：写出来比让模型自己撞错便宜。 */
const AGE_LIMITATIONS = [
  '- No `shortestPath()` / `allShortestPaths()`. Write an explicit typed multi-hop pattern instead.',
  '- No multi-type edge patterns like `[r:A|B]`. Write one pattern per relationship type.',
  '- No `datetime()`. Stored dates are strings; compare them as strings.',
  '- A variable-length path must be anchored on a specific node, typed, and bounded (e.g. `-[:SUBSTRATE_OF*1..2]->` inside a larger anchored pattern). Unanchored or unbounded traversal over the interaction graph explodes and is cancelled by the statement timeout.',
].join('\n');

/** 每种拒绝原因配一句"怎么改"，重试才有方向而不是随机重问。 */
const RETRY_HINTS: Record<string, string> = {
  not_read_only:
    'The query must be read-only: no CREATE / MERGE / SET / DELETE / DETACH / REMOVE / DROP / CALL / COPY, and it must start with MATCH, OPTIONAL MATCH, WITH, UNWIND or RETURN.',
  multiple_statements:
    'Return exactly one statement — remove everything after the first one.',
  syntax_error:
    'Fix the Cypher syntax. A common mistake is `OPTIONAL MATCH ... AS x` — aliases belong on the RETURN projection, not on MATCH.',
  unsupported_feature:
    'Rewrite without the unsupported construct (see the AGE limitations above).',
  timeout:
    'The query was cancelled by the statement timeout. Narrow it: anchor on specific nodes, filter by name or identifier early, add tighter relationship types, and reduce the traversal depth.',
  // 客户端侧的纠正信号（不是 sidecar 的拒绝类别）：行回来了但一条引用都没有。
  missing_provenance:
    "The statement ran and returned rows, but no provenance id came back. Every relationship in this graph carries a `prov` property. If the answer rests on a relationship, add it to the projection (`r.prov AS prov`, one per relationship the answer uses). If the question is about a node's own fields and no relationship is involved, return the same query unchanged.",
};

const SYSTEM_PROMPT = `You translate a pharmacology question into ONE read-only Cypher query for an Apache AGE graph.

The graph holds DrugBank's structured data: drugs, their targets / enzymes / transporters / carriers, ATC classes, and the typed relationships between them. It was ingested deterministically from structured fields — no text extraction — so every edge is an authoritative DrugBank assertion.

Output rules (the executor rejects the query when any is broken):
- Exactly one statement, nothing after it.
- Read-only: it must start with MATCH, OPTIONAL MATCH, WITH, UNWIND or RETURN, and it must never use CREATE, MERGE, SET, DELETE, DETACH, REMOVE, DROP, CALL or COPY.
- Always end with an explicit LIMIT of at most 100.
- Use ONLY the node labels and relationship types listed in the schema block below. Never invent a label or a relationship type.
- Pass every literal value through \`params\` and reference it as \`$name\`; never inline a value into the query text.
- Return at most 6 columns, each with an \`AS\` alias. Prefer human-readable names; include an identifier only when it disambiguates.
- Filter before you project. A query that scans millions of edges is cancelled by the statement timeout.

Citation rule (this is how the answer becomes auditable):
- Every relationship carries a \`prov\` property: a provenance id naming the source row the edge came from. Whenever the answer rests on a relationship, return that relationship's \`prov\` as a column aliased \`prov\` — \`RETURN d.name AS drug, o.name AS other, r.prov AS prov\`. Returning \`r\` itself also works.
- Return one \`prov\` per relationship the answer asserts. On a multi-hop question that means one per hop that matters (e.g. \`r1.prov AS prov\`, \`r2.prov AS prov2\`).
- Never fabricate a \`prov\` value, and never filter on one.

Matching rules:
- Names are stored capitalised exactly as DrugBank writes them ("Warfarin", "Ibuprofen"), and equality is case-sensitive. Always match names case-insensitively: \`WHERE toLower(d.name) = toLower($name)\`. A bare \`{name: $name}\` match silently returns zero rows, and zero rows would then be reported as "DrugBank asserts no such relationship" — a wrong answer that looks right.
- Prefer matching on the identifier (\`drugbank_id\`, \`uniprot_id\`) when the question gives one; it is exact and case-insensitive by construction.
- Enzymes, transporters and receptors are asked about by abbreviation ("CYP3A4", "UGT1A1", "ABCB1") but stored under their full DrugBank name ("Cytochrome P450 3A4"). The abbreviation is the protein's \`gene_name\`, so match either field — \`WHERE toLower(p.gene_name) = toLower($enzyme) OR toLower(p.name) = toLower($enzyme)\` — or, when the question gives a partial name, \`toLower(p.name) CONTAINS toLower($enzyme)\`. Matching only \`p.name\` against an abbreviation returns zero rows for a protein that is in the graph.
- ATC classes are keyed by \`code\` and carry no name: a question about "which ATC class" is answered with the code(s) from \`IN_ATC_CLASS\`, and a broader class is reached by walking \`SUBCLASS_OF\` upward from that code. There is no class label in this graph, so do not filter on \`name\` for an ATCClass node — it has none.

Apache AGE 1.7 limitations (hard — these fail at execution):
${AGE_LIMITATIONS}

Reasoning rules:
- "Can A and B be taken together?" is a question about the interaction edge between A and B: match the edge and report what its properties say.
- Interaction questions are answered from interaction edges, never from text similarity.
- Keep roles distinct: an inhibitor of an enzyme and a substrate of that enzyme are clinically different. Use the specific relationship type rather than a generic one.
- Never answer from general knowledge. If the graph has no such edge, zero rows is the correct and useful answer — and it means "this graph has no such edge", never "no such relationship exists".

Multi-hop shapes that questions are usually asking for (write the shape, then filter):
- "which drugs share a target with X" — two hops through the same protein, and the relationship types are NOT known in advance, so leave them untyped: \`MATCH (x:Drug)-[r1]->(p:Protein)<-[r2]-(y:Drug) WHERE x.drugbank_id = $id AND y.drugbank_id <> $id\`. Narrowing this by guessing one relationship type is the usual reason a question with hundreds of real answers returns nothing.
- "which drugs inhibit an enzyme that metabolizes X" / "…metabolized by the same enzyme as X" — the enzyme links the two drugs, and each side has its own role: \`MATCH (x:Drug)-[:SUBSTRATE_OF]->(e:Protein)<-[:INHIBITS]-(i:Drug)\`. A substrate link is \`SUBSTRATE_OF\`, an inhibitor link is \`INHIBITS\`; matching both sides with one type returns nothing.
- "is A an inhibitor of the enzyme that metabolizes B" — the same shape anchored on both drugs: \`MATCH (b:Drug)-[:SUBSTRATE_OF]->(e:Protein)<-[r:INHIBITS]-(a:Drug)\`.
- A question about a class ("which ATC class", "which drugs are in class X") is the \`IN_ATC_CLASS\` edge, and the ATC hierarchy is \`SUBCLASS_OF\` (parent -> child) if a query needs to widen to a parent class.

Also return a one-sentence \`rationale\` describing what the query retrieves.`;

export function buildOntologyCypherSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildOntologyCypherUserPrompt(
  context: OntologyCypherContext,
): string {
  const sections: string[] = [
    formatSchemaBlock(context),
    `Question: ${context.question}`,
  ];

  if (context.previousError != null && context.previousCypher != null) {
    sections.push(formatRetryBlock(context));
  }

  sections.push('Write the query.');
  return sections.join('\n\n');
}

function formatSchemaBlock(context: OntologyCypherContext): string {
  const labels = context.schema.labels
    .slice(0, MAX_TYPES_IN_PROMPT)
    .map((entry) => `${entry.label} (${String(entry.count)})`)
    .join(', ');
  const relationships = context.schema.relationshipTypes
    .slice(0, MAX_TYPES_IN_PROMPT)
    .map((entry) => `${entry.label} (${String(entry.count)})`)
    .join(', ');

  return [
    `Graph schema (${context.schema.graph}; ${String(context.schema.nodeCount)} nodes / ${String(context.schema.relationshipCount)} relationships):`,
    `- Node labels: ${labels.length > 0 ? labels : '(none)'}`,
    `- Relationship types: ${relationships.length > 0 ? relationships : '(none)'}`,
  ].join('\n');
}

function formatRetryBlock(context: OntologyCypherContext): string {
  const kind = context.previousErrorKind ?? 'rejected';
  // 未登记的 kind 不编造"怎么改"：只有知道原因才谈得上纠正方向，硬套一句提示
  // 就是让模型去修一个我们并不了解的错误（`internal` 正是这一类——sidecar 自己
  // 出了问题，不是查询写错了）。
  const hint = RETRY_HINTS[kind];

  return [
    `Your previous query was rejected (attempt ${String(context.attempt)}).`,
    `Rejected query:\n\`\`\`cypher\n${context.previousCypher ?? ''}\n\`\`\``,
    `Executor error (${kind}): ${context.previousError ?? ''}`,
    ...(hint != null ? [`How to fix it: ${hint}`] : []),
  ].join('\n\n');
}
