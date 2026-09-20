---
status: active
owner: backend
quadrant: reference
updated: 2026-09-20
---

# Assistant Safety

本文件是 [[archive/01-reference/contracts/assistant-contract]] 拆分后的子文档。

相关子文档：

- [[archive/01-reference/contracts/assistant-capabilities]]
- [[archive/01-reference/contracts/assistant-rollout]]

## AI Safety Policy

The shared `LlmSafetyPolicyService` forbids content that could be interpreted as medical advice:

- Diagnosis, confirmed conditions, or treatment plans.
- Recommendations to start, stop, increase, decrease, or adjust medication dosage.
- Prescriptions or curing claims.

Forbidden patterns default to a hardcoded baseline. They can be overridden at runtime via the
`AI_SAFETY_FORBIDDEN_PATTERNS` environment variable (comma- or newline-separated regex strings). If
the variable is empty or unset, the default baseline is used.

Rules:

- AI output must never contain diagnosis, prescription, dosage adjustment, or treatment-plan
  wording.
- Every bounded-linear AI module must run policy checks on both final output and streamed
  intermediate summary text.
- Policy rejection must trigger the fallback copy path, not an empty/error response.
- Filtered medical QA retrieval is assistant-only reference material. It must not be treated as
  authoritative diagnosis, prescription, dosage, or treatment advice.

## Knowledge-Source Boundaries

Drug knowledge reaches the assistant through deliberately separated paths. None may silently stand
in for another, and results from different sources must not be merged into a single uncited claim:

- **Chinese prose** (leaflet fields, medical QA) is retrieved via the LightRAG sidecar. QA hits are
  `open_corpus`; leaflet hits are `citable` and carry `leafletId` / `sourceField`.
- **Chinese product catalogue** is answered by SQL key lookup only — it describes what a product is,
  and performs no semantic inference.
- **English DrugBank** splits in two: narrative fields go to vector retrieval, while structured
  relations (targets, interactions, ATC) go to ontology-augmented generation over typed edges
  (`INHIBITS`, `SUBSTRATE_OF`, `ACTS_ON`, …). Collapsing "drugs that inhibit an enzyme" with "drugs
  metabolized by that enzyme" into "related" is a clinically meaningful error, and typed retrieval
  exists to prevent it.

Rules:

- Source selection is a server-side decision. Callers may name a source, but the workspace mapping
  and the `verifiability` value are assigned by the server, never by the model.
- Retrieval sources are never merged. `search_cn_medicine_products` / `get_cn_medicine_detail` use
  SQL, Chinese prose uses LightRAG, and DrugBank passages use Lucent's own pgvector tables.
- Every ontology-grounded conclusion must carry citations resolvable to a source table and row; a
  result with rows but no citations is reported as `uncited`, not `citable`.
- Rule-derived conclusions must be marked as derived and must not be presented in the same shape as
  directly asserted data.
- Unreviewed cross-source `SAME_AS` mappings must never be consumed by conclusion-level reasoning.
- **Absence of evidence is not evidence of absence.** A missing interaction edge means the source
  data contains no such assertion, not that no interaction exists clinically. Reasoning over a
  truncated graph must declare its scope rather than let "not derived" read as "does not exist".
- Service unavailability is reported as unavailable. It must never degrade silently into an empty
  result.
