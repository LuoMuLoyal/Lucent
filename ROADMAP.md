# Lucent Roadmap

This document describes the planned evolution of the Lucent backend.
It is a living document — directions shift as the product and community grow.

## Status

Lucent is currently at `v1.0.0-dev`. The core feature set is implemented and
CI/CD is operational, but the project has not yet shipped a stable release.

**What works today**

- Authentication: credential login + WeChat / Apple / QQ OAuth, JWT sessions,
  in-app Security PIN with short-lived elevation tokens, session management
- Health records: daily records (water, meal, vital, mood, symptom, activity,
  note, sleep), dose logs, medicine reminders, allergies / conditions / current
  medicines
- AI pipeline: LangGraph tool-loop assistant with LLM function calling,
  bounded-linear (Today analysis, Report summary, NL record candidates),
  agent-based assistant with source-split RAG, meal-analysis vision pipeline,
  SSE streaming, LLM retry with exponential backoff
- Medicine knowledge: CN products + leaflet chunks, DrugBank drugs, medical QA
  corpus — three independent vector retrieval sources
- Today suggestion engine: signal collectors → rule engine → scoring/arbitration
  → lifecycle management → feedback-driven boost/suppression, 3-layer cache
- Data export: BullMQ async PDF export with inline fallback, clinic summary
  share links + PDF generation
- Legal documents: `LegalDocument` model + public API + AdminJS management
- Infrastructure: Winston structured logging (daily rotate file + JSON stdout),
  AdminJS panel, Tencent COS uploads, full CI/CD via GitHub Actions, Blue-Green
  zero-downtime deployment with auto-rollback
- Observability: Prometheus metrics (HTTP, BullMQ, LLM), Grafana dashboards
  (LLM call rate/duration/tokens, BullMQ queue depth), request ID correlation
- Caching: NestJS CacheModule with Redis-backed Keyv store, 8 cached services
  (suggestions, reports dashboard, today analysis context, legal documents,
  user settings, medicine safety tips, support resources, suggestion history)
- Queue infrastructure: `BullmqQueueFactory` with shared Redis connection, 8
  queues (mail, meal-analysis, data-export, today-analysis, report-summary,
  suggestion-explanation, medicine-recognition, clinic-summary-pdf), Redis
  unavailable → sync fallback
- Repository abstraction: 6 modules with Port pattern (daily-records, assistant,
  auth, user-health-context, medicine-dose-logs, medicine-reminders)
- Security: global ThrottlerGuard, per-endpoint rate limiting (LLM explain
  5/min, feedback 20/min), JWT status field enforcement, soft-delete safety,
  Security PIN lifecycle
- Testing: Vitest (2105 unit tests + 2400 E2E tests), contract tests (OpenAPI
  schema validation), security tests (authorization, fuzzing, rate-limiting),
  k6 performance tests, full E2E coverage of all ~80 endpoints
- Deployment: Dockerfile 3-stage build, Docker Compose with network isolation +
  resource limits, Nginx with gzip/security headers/SSE optimization,
  Blue-Green deploy script with smoke test + auto-rollback, staging environment

**What's missing**

- Push notification delivery (FCM / APNs)
- Audit logging
- Database backup strategy
- Data retention and deletion policies

---

## Directions

Priority framework follows the cross-project Product Brainstorm
(`Luminous/docs/01-product/Product_Brainstorm_2026-07-07.md`). Lucent's
roadmap aligns backend work with the frontend P0/P1/P2/P3 priorities.

### Production Readiness → `v1.0.0`

Ship the first stable release. Most infrastructure items are complete.

- **✅ Observability** — Prometheus metrics export, Grafana dashboards, LLM/BullMQ
  metrics integration
- **✅ AI Rate Limiting** — per-endpoint Redis-backed throttling with
  configurable thresholds
- **✅ Staging Environment** — dedicated GitHub Environment, auto-deploy on main
- **Backup & Recovery** — PostgreSQL scheduled backups, encrypted offsite
  storage, documented restore procedure
- **Audit Logging** — `audit_logs` table for security-sensitive operations
  (password changes, identity binding, data exports, admin panel writes)
- **Quality Gate** — raise coverage thresholds, add AI safety policy edge-case
  tests, expand E2E coverage for critical user journeys

### Stability & Operations → `v1.1.0`

Keep the system running smoothly as usage grows. Supports frontend P2 features.

- **Push Notifications** — FCM (Android) + APNs (iOS) integration, scheduled
  medicine reminder delivery, AI completion notifications, quiet hours
- **Load Testing** — establish performance baselines (k6 / autocannon), document
  QPS / latency / concurrency limits
- **Data Retention & Privacy** — retention policies per data category, account
  deletion pipeline with cascade cleanup, anonymized data export
- **Dependency Security** — Dependabot / Renovate, `pnpm audit` in CI, base
  image patch tracking
- **Clinic Summary Support** — backend APIs for frontend P2 clinic summary
  template (data already available, may need export format enhancements)

### Feature Expansion → `v1.2.0`

Extend product capabilities on a stable foundation. Supports frontend P3 features.

- **Red-Flag Rule Engine** — fixed rule table for high-risk symptom patterns
  (fever ≥39°C persistent, allergic reaction, breathing difficulty), static
  safety copy, Today page card integration
- **Smart Reminder Priority** — `priority_adjustment` field on reminder rules,
  context-aware scheduling based on recording patterns
- **Assistant Enhancements** — conversation rename / delete / search, enhanced
  cross-conversation memory with user controls, new tools (medication safety
  check, trend analysis, reminder proposals)
- **Report Enhancements** — monthly / quarterly reports, period-over-period
  comparison, CSV and image export formats
- **Medicine Safety Rule Engine** — rule-based drug interaction checking,
  duplicate ingredient detection, allergy cross-checking, graded results
  consumable by the assistant
- **Internationalization** — multi-language AI output, timezone-aware date
  queries

### Scale & Compliance → `v2.0.0`

Prepare for larger scale and stricter compliance requirements.

- **Horizontal Scaling** — statelessness audit, multi-instance deployment,
  read replica evaluation
- **API Versioning** — v2 prefix strategy, backward compatibility window,
  deprecation headers, OpenAPI versioning
- **Advanced Compliance** — data processing agreement support, data
  portability (JSON export), consent management
- **AI Deepening** — RAG quality metrics, user feedback collection, token cost
  monitoring and caching, multimodal expansion (sleep screenshots, medical
  report OCR)
- **Disaster Recovery** — multi-AZ evaluation, RTO / RPO definition, failover
  runbook, periodic drills

---

## Versioning

| Version  | Theme                  | Status      |
| -------- | ---------------------- | ----------- |
| `v1.0.0` | Production readiness   | In progress |
| `v1.1.0` | Stability & operations | Planned     |
| `v1.2.0` | Feature expansion      | Planned     |
| `v2.0.0` | Scale & compliance     | Planned     |

Releases follow [Semantic Versioning](https://semver.org/). Each release passes
the full `pnpm check` gate and staging smoke tests before production deploy.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) for
development setup, code conventions, and documentation rules.

## Feedback

This roadmap is open to discussion. Open an issue with the `roadmap` label to
propose changes, suggest priorities, or flag missing items.
