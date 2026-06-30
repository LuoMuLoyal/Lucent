# Lucent TODO

Last updated: 2026-06-30

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to one branch or security check, but do not scatter project-level follow-up lists across changelogs or random docs.

**When a follow-up item is completed:** delete it from this file, move resulting facts to `Luminous/docs/Current_State.md`, and record the completion in both today's `Lucent/docs/migration-log/YYYY-MM-DD.md` and `Luminous/docs/migration-log/YYYY-MM-DD.md` as cross-repo sync evidence.

## Module Boundaries

## Report Export

- Extend report export into:
  - optional async worker execution instead of request-thread generation
  - richer structured sections or chart blocks if doctor-facing readability needs more than the current text-first PDF template

## Assistant RAG

- `get_medicine_leaflet_context` is implemented with keyword product matching and fixed-size chunk retrieval. Future iterations may add relevance ranking, vector/semantic search, or chunk re-ranking when retrieval quality needs improvement.
  Source context: `src/modules/assistant/tools/assistant-tool-leaflet-read.service.ts`, `scripts/import/medicine/rebuild-leaflet-index.ts`
- Evaluate whether to integrate the `alpaca_zh_demo.json` medical Q&A dataset (~1.36M records) as a separate RAG corpus. Before any import, define content filtering, scope boundaries, and compliance review. See `docs/public/data-sources.md` for the current boundaries.
  Source context: `DrugDataBase/医疗问答数据集一共135万条/数据集/alpaca_zh_demo.json`

## Auth / Security

- Add optional 2FA challenge verification before issuing tokens.
  Source context: `src/modules/auth/services/credential-auth.service.ts`
- Add more OAuth providers such as Apple or Google when product scope requires them.
  Source context: `src/modules/auth/types/oauth.types.ts`
