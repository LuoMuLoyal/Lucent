# Changelog

All notable changes to Lucent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is a **release-level summary**. The detailed, dated record of every change lives in
[`docs/logs/migration-log/`](docs/logs/migration-log/) (one file per day, append-only), and design
decisions live in [`docs/reference/adr/`](docs/reference/adr/).

---

## [Unreleased]

Lucent has not shipped a stable release yet. Everything below is tracked under `[Unreleased]` and
will be assigned a version when the first release milestone in [ROADMAP.md](ROADMAP.md) is reached.

### Added

#### Authentication, accounts and sessions

- Credential login and registration, plus WeChat (web and mobile), Apple, QQ and Google OAuth
- JWT access + refresh token rotation backed by device-session records, with remote session
  revocation
- In-app Security PIN with short-lived elevation tokens, and `SecurityElevationGuard` on password
  change, email change, identity management and data export
- Password reset, account deletion and email verification flows
- Request throttling with a login-failure cache

#### Health records and user context

- Daily records across water, meal, vital, mood, symptom, activity, note and sleep
- Dose logs with taken / skipped / missed / planned states, and medicine reminders with day-of-week
  scheduling plus delivery tracking
- Health events with user-confirmed start and end, per-day check-ins, and related causes and
  medicines
- Health context: allergies, conditions, current medicines, and the profile that carries
  date of birth, sex, height, weight, activity level and dietary preferences
- Record image attachments via signed object-storage URLs
- User settings, including assistant enablement, memory and per-source context toggles

#### AI pipeline

- **Bounded-linear pipeline** (context → copy → generator → policy → persistence) for Today
  analysis, Report summaries and natural-language record candidates, each with SSE streaming
- **Agent-based assistant** on LangGraph: intent routing, bounded retrieval loops with an explicit
  stop reason, persisted conversations and optional cross-conversation memory
- **Strictly separated retrieval sources**: Chinese prose through LightRAG, DrugBank passages
  through Lucent's own pgvector tables, and Chinese product lookups through SQL
- **Proposal-based writes**: create / update / delete of records and settings are emitted as
  time-limited proposals that the user must confirm before the server applies them atomically
- **Meal-analysis vision pipeline**: dish recognition plus deterministic food-composition matching,
  asynchronous execution on BullMQ with an inline fallback, dish-template learning from
  user-confirmed analyses, and an output safety filter
- `AiSafetyPolicyService` applied to every AI output, including streamed chunks, forbidding
  diagnosis, prescription and dosage output
- Role-based OpenAI-compatible model factory (analysis, vision, language, chat, chat compression,
  embedding) so each role has its own endpoint, key and model name

#### Medicine knowledge and retrieval

- DrugBank structured import, Chinese medicine products and leaflet chunks, and a medical QA corpus
- **Ontology-Augmented Generation (English side)**: DrugBank structured facts are mapped into the
  graph backend deterministically, with no LLM extraction in the loop; typed multi-hop reasoning
  runs only through pre-registered, versioned rules
- **Proposition-level provenance**: every assertion resolves back to its source table, source row
  and source text, and provenance records are chained by digest so any later edit or deletion is
  detectable; the chain can be exported as W3C PROV-O
- **Explicit retrieval availability**: an unavailable retrieval or reasoning service is reported as
  unavailable rather than degrading into an empty result that downstream code would read as "no
  risk found"

#### Proactive suggestions

- Rule engine over dose logs, daily records, profile and health events, with arbitration,
  suppression and lifecycle layers
- Write-time materialisation: suggestions are recomputed when data changes, so reading the home
  screen never triggers a recomputation
- User feedback that genuinely participates in later filtering, including "do not remind me again"

#### Review, export and sharing

- Coverage-aware daily / weekly / monthly review that abstains when evidence is thin, rather than
  emitting a weaker claim
- Health-event review with a fixed four-section structure
- Visit summary with field-level authorisation (free-text notes off by default), PDF export, and
  revocable time-limited share links that store only a token hash
- Asynchronous PDF data export on BullMQ with an inline fallback

#### Platform and operations

- Layered health probes: `/health`, `/health/live`, `/health/ready` and `/health/deep`, where the
  deep probe actually executes dependency checks
- Structured logging with request context and `X-Request-Id` propagation, plus W3C Trace Context
  propagation for cross-service tracing
- Metrics, logs and traces shipped to a dedicated monitoring host, with dashboards and Grafana
  unified alerting provisioned from versioned YAML
- Multi-architecture container images built natively per architecture and merged into a manifest
  list; the entrypoint applies migrations before starting, and aborts startup if they fail
- Embedded AdminJS panel at `/admin`, with API documentation at `/api/docs`
- OpenAPI as the single API contract: exported from controller and DTO code, with semantic
  comparison in CI so a stale committed spec fails

### Security

- Argon2 password hashing
- Database-level unique constraint on the user email
- `AiSafetyPolicyService` applied to all AI output, final and streamed
- Vision output filter on meal analysis (length limits, markup stripping, forbidden patterns)
- Internal error messages no longer leaked through SSE streams
- SQL injection fixes in the RAG index rebuild scripts
- Coverage-aware abstention and explicit retrieval unavailability, so a missing dependency can never
  be mistaken for a negative finding
- Digest-chained provenance with a verification endpoint, so the audit trail cannot be silently
  rewritten
- Environment-based secret management; no hardcoded credentials in code

### Notes

- Prisma's generated client is intentionally local-only and stays ignored; regenerate it from
  `prisma/schema.prisma` and the migrations.
- `docs/reference/generated/openapi.json` **is** tracked and must stay in sync with the code.

---

## Version History

| Version     | Status         | Notes                                                                                          |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `0.1.0-dev` | In development | Current state: all feature areas above exist and are exercised by tests; no stable release yet |
| `1.0.0`     | Planned        | First release milestone — see [ROADMAP.md](ROADMAP.md)                                         |

Lucent has not published a stable release. Per [Semantic Versioning](https://semver.org/), major
version zero (`0.y.z`) is for initial development, and the public API should not be considered
stable until `1.0.0`.
