# Public Contracts

This directory contains API contract documents shared between Lucent (backend) and Luminous (frontend). These documents define the **boundary** between backend and client — what the API promises, what it explicitly does not support, and the shape of data that crosses the boundary.

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

| Document                    | API Surface                                                            |
| --------------------------- | ---------------------------------------------------------------------- |
| `assistant-contract.md`     | AI assistant capability, permission boundary, SSE streaming, tool list |
| `data-sources.md`           | Medicine data import strategy, source mapping, DB table layout         |
| `environment-contract.md`   | Environment snapshot API (pollen, UV, air quality, etc.)               |
| `mine-settings-contract.md` | User settings, support resources, app info, data export                |
| `reminder-contract.md`      | Medicine reminder schedule, notification preferences, delivery audit   |

## Rules

- These documents are the **authoritative API boundary** — when backend and frontend disagree, these contracts (plus generated `openapi.json`) are the tiebreaker.
- Update the relevant contract when the API boundary changes (new fields, new endpoints, removed features, changed non-goals).
- Do not put UI implementation details or product roadmap in these documents.
- These contracts are mirrored to `Lumos-docs/` for browsing. The repo-local copy is always the source of truth.

## Relationship to openapi.json

`docs/openapi.json` is the machine-readable API contract (generated). These `public/*.md` files provide human-readable context that OpenAPI alone does not capture: capability boundaries, non-goals, rollout status, and integration notes.
