---
status: active
owner: backend
quadrant: reference
updated: 2026-08-31
---

# Assistant Safety

本文件是 [[archive/assistant-contract]] 拆分后的子文档。

相关子文档：

- [[archive/assistant-capabilities]]
- [[archive/assistant-rollout]]

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
