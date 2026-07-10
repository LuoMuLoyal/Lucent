# API Contracts

This directory contains API contract documents shared between Lucent (backend) and Luminous
(frontend). These documents define the **boundary** between backend and client — what the API
promises, what it explicitly does not support, and the shape of data that crosses the boundary.

## Purpose

Each contract document defines:

- **What** the endpoint(s) provide
- **What** the client can expect in response
- **What** is explicitly out of scope (non-goals)
- **Current implementation status** vs planned

## Audience

- Frontend developers building against these contracts
- Backend developers implementing or extending these APIs
- Product owners defining feature scope

## Documents

- `assistant-contract.md`
  - API Surface: AI assistant overview, boundary, routes, conversation/streaming contracts
- `assistant-capabilities.md`
  - API Surface: AI assistant capability shape, tools, envelopes, proposals
- `assistant-rollout.md`
  - API Surface: AI assistant rollout/runtime truth
- `assistant-safety.md`
  - API Surface: AI assistant safety policy
- `data-sources.md`
  - API Surface: Medicine data source index and cross-source strategy
- `data-sources-cn-products.md`
  - API Surface: Chinese product/leaflet source mapping and import
- `data-sources-drugbank.md`
  - API Surface: DrugBank source mapping and import
- `data-sources-medical-qa.md`
  - API Surface: Medical QA corpus boundary
- `data-sources-food-composition.md`
  - API Surface: Food composition / meal analysis placeholder
- `environment-contract.md`
  - API Surface: Environment snapshot API (pollen, UV, air quality, etc.)
- `mine-settings-contract.md`
  - API Surface: Mine/Settings overview and user settings
- `support-resources-contract.md`
  - API Surface: Public support resource entries
- `app-info-contract.md`
  - API Surface: App metadata endpoint
- `data-export-contract.md`
  - API Surface: Data export request flow
- `reminder-contract.md`
  - API Surface: Medicine reminder schedule, notification preferences, delivery audit

## Rules

- These documents are the **authoritative API boundary** — when backend and frontend disagree,
  these contracts (plus a freshly exported local `openapi.json`) are the tiebreaker.
- Update the relevant contract when the API boundary changes (new fields, new endpoints, removed
  features, changed non-goals).
- Do not put UI implementation details or product roadmap in these documents.
- These contracts are mirrored to `Lumos-docs/` for browsing. The repo-local copy is always the
  source of truth.

## Relationship to openapi.json

`docs/openapi.json` is the machine-readable API contract (generated locally, ignored in git). These
contract files
provide human-readable context that OpenAPI alone does not capture: capability boundaries,
non-goals, rollout status, and integration notes.
