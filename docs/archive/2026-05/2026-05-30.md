# Migration Log - 2026-05-30

## Auth Security Baseline

- Login credentials must be exactly one: password or code.
- Soft-deleted users excluded from default queries.
- JWT `sub`/`subject` deduplication.
- E2E baseline: register, login, refresh, logout, me.
- Dual local PostgreSQL setup: dev (15432) + test (5432).

## Medicine Knowledge Foundation

- DrugBank XML import (drugs, links, targets with stable IDs).
- Chinese medicine product import via scripted pipeline.
- Source-aware search/detail APIs.
