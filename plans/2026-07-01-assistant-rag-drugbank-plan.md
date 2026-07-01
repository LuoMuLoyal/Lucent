# Assistant RAG + DrugBank Retrieval Closeout

Last updated: 2026-07-01

## Completed in this round

- Assistant retrieval tool surface is split into:
  - `search_medicine_leaflets`
  - `search_medical_qa_corpus`
  - `resolve_drugbank_entity`
  - `search_drugbank_passages`
- Assistant runtime carries bounded retrieval-loop state and prompt rules for source priority and no keyword fallback after retrieval misses.
- Chinese leaflet retrieval now returns vector-page metadata and uses the new tool name end-to-end.
- DrugBank entity resolution and scoped passage retrieval are wired into assistant dispatch and covered by tests.
- Leaflet index rebuild script now matches the current `cn_medicine_leaflets` schema and writes richer embedding metadata.
- Public assistant/data-source docs and generated OpenAPI have been synced to the current contract.

## Remaining follow-up

- Medical QA import still requires a local NDJSON source file at:
  - `D:\25080\Documents\VSCodeProject\Lumos\DrugDataBase\医疗问答数据集一共135万条\数据集\medical_qa.ndjson`
- DrugBank RAG index builder is still a smoke-check skeleton; it reports source row / chunk counts but does not yet persist passages or embeddings.
- Leaflet retrieval is vector-first and cursor-aware, but it is not yet doing a separate product-level vector resolve stage; current product ambiguity is inferred from chunk metadata.

## Observable verification state

- Focused assistant Jest suites: pass
- Full backend Jest suite: pass
- `tsconfig.typecheck.json`: pass
- `scripts/tsconfig.json`: pass
- Nest build: pass
- `rebuild-leaflet-index.ts --dry-run`: pass
- `rebuild-drugbank-rag-index.ts --dry-run --limit 100`: pass with `sourceRows: 0`
- `import-medical-qa.ts --filter --limit 100`: blocked by missing local NDJSON source file
