# Data Sources: Medical QA Corpus

本文件是 [[data-sources]] 拆分后的子文档。

相关子文档：

- [[data-sources-cn-products]]
- [[data-sources-drugbank]]
- [[data-sources-food-composition]]

### Assistant-only medical QA corpus: 医疗问答数据集

- **Location:** `DrugDataBase/医疗问答数据集一共135万条/数据集/alpaca_zh_demo.json`
- **Size:** ~1.83 GB, ~1.36 million records
- **Format:** JSON array of Alpaca-style objects: `{ "id": "DX_N", "instruction": "问题", "output":
"回答" }`
- **Status:** assistant-only reference corpus candidate; import/indexing stays separate from leaflet
  and DrugBank stores and must preserve explicit safety filtering and disclaimer behavior.
- **Import script:** `scripts/import/medicine/import-medical-qa.ts` streams the NDJSON source,
  applies a safety filter, writes `medical_qa_chunks`, and optionally embeds into
  `medical_qa_embeddings`.

Smoke-test command (100 records, 100 chunks):

```bash
pnpm exec ts-node scripts/import/medicine/import-medical-qa.ts --filter --limit 100
pnpm exec ts-node scripts/import/medicine/import-medical-qa.ts --embed --embed-limit 100 --embed-batch-size 10
```

Why it is different from leaflet and DrugBank RAG:

- Leaflets are official package inserts tied to a product; the Q&A set is generic medical
  question/answer content of unknown provenance.
- The retrieval path is open-domain and lower-trust, so it must remain a separate assistant-only
  semantic retrieval path (e.g., `medical_qa_chunks` + dedicated vector store).
- Many answers contain diagnosis and treatment recommendations. Using them verbatim would cross the
  project's medical red line.

**Boundaries if integrated in the future:**

1. **Scope restriction:** only use it for general health education, symptom explanations, and "when
   to see a doctor" guidance. Exclude diagnosis, prescription, dosage, and treatment plans.
2. **Content filtering:** pre-filter or tag records; drop or block high-risk categories.
3. **Disclaimer:** every answer sourced from this dataset must be labeled as reference-only and not
   a substitute for professional medical advice.
4. **Human review:** treat the dataset as unverified; do not present it as authoritative.
5. **Separate storage:** do not mix Q&A chunks with leaflet chunks or DrugBank passages; keep
   distinct storage, metadata, and retrieval logic.
6. **Legal/compliance review:** confirm with legal/product before enabling user-facing retrieval.

The frontend linear medication suggestion/risk flow must not consume this QA corpus in the current
phase.

As of 4.0.0, `ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx` is the locked CN source for
both structured product lookup and leaflet RAG. The data fusion pipeline is frozen for 4.0.0;
further improvements (DrugBank bridging, product aggregation, English translation) are scheduled for
4.x.

Current bridge status (verified 2026-07-02 on the local V2 workbook snapshot):

- `ProductsEnriched` currently contains a `drugbank_ids` column, but the reviewed local snapshot has
  **0 populated rows** in that column.
- Do not treat `drugbank_ids` as an already solved CN -> DrugBank bridge in runtime logic.
- There is no plan to build a maintained CN -> DrugBank mapping table or pipeline in this phase.
  Cross-source questions are handled by the assistant's source-split tools instead of a runtime
  bridge.
