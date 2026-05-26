---
title: "Lucent Data Sources"
tags:
  - backend
  - data
aliases:
  - 数据源
  - 外部数据
created: 2026-05-25
---

# Data Sources

Last updated: 2026-05-26

## Target Directory

Local external data directory:

```text
D:\25080\Documents\VSCodeProject\Lumos\DrugDataBase
```

This directory is not tracked by Git and must not be packaged into Flutter.

## Current Sources

- `FullDrugDetail.xlsx`: detailed Chinese medicine product and instruction source.
- DrugBank files: English scientific enrichment source, including XML, CSV, FASTA, and SDF assets.

## Ownership

- Lucent owns all imports, normalization, validation, and source mapping.
- PostgreSQL is the durable query source after import.
- Flutter only consumes Lucent APIs and may keep small user-owned offline cache snapshots.

## Import Rules

- Keep raw Chinese and DrugBank imports in separate staging tables first.
- Do not merge Chinese product records with DrugBank records until matching rules are reviewed.
- Use small fixtures for tests; do not run normal tests against the full xlsx or full XML.
- Import scripts must be idempotent and report source rows, imported rows, rejected rows, and sample rejection reasons.
- Large files remain outside Git, generated dumps remain outside Git, and Flutter assets must not include these sources.

## Open Decisions

- Chinese-first display model versus bilingual display model.
- DrugBank licensing and which fields can be used in user-facing responses.
- Matching strategy between Chinese products and DrugBank drugs.
- Whether image URLs should be proxied, cached, or left as source references.
