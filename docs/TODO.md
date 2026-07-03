# Lucent TODO

Last updated: 2026-06-30

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to one branch or security check, but do not scatter project-level follow-up lists across changelogs or random docs.

**When a follow-up item is completed:** delete it from this file, move resulting facts to `Luminous/docs/Current_State.md`, and record the completion in both today's `Lucent/docs/migration-log/YYYY-MM-DD.md` and `Luminous/docs/migration-log/YYYY-MM-DD.md` as cross-repo sync evidence.

## Module Boundaries

## Report Export

- Richer structured sections or chart blocks if doctor-facing readability needs more than the current text-first PDF template.

## Assistant RAG

- Keep assistant retrieval source-split. Do not collapse Chinese leaflets, DrugBank passages, and medical QA into one shared corpus or one undifferentiated search tool.
  Source context: `src/modules/assistant/tools/`, `docs/public/assistant-contract.md`, `docs/public/data-sources.md`
- Keep medical QA assistant-only until a separate legal/product decision explicitly allows any broader surface. Frontend linear medication flows must not consume QA-corpus retrieval results.
  Source context: `DrugDataBase/医疗问答数据集一共135万条/数据集/alpaca_zh_demo.json`, `docs/public/data-sources.md`
- Cross-source CN -> DrugBank mapping is intentionally not a runtime table or alias map. Use assistant source-split structured lookup tools for cross-source questions instead of building a shared mapping layer.
  Source context: `src/modules/assistant/tools/services/assistant-tool-medicine-lookup.service.ts`, `docs/public/assistant-contract.md`

## Auth / Security

- Add more OAuth providers such as Apple or Google when product scope requires them.
  Source context: `src/modules/auth/types/oauth.types.ts`
