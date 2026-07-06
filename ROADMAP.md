# Lucent Roadmap

This document describes the planned evolution of the Lucent backend.
It is a living document — directions shift as the product and community grow.

## Status

Lucent is currently at `v1.0.0-dev`. The core feature set is implemented and
CI/CD is operational, but the project has not yet shipped a stable release.

**What works today**

- Authentication: credential login + WeChat / Apple / QQ OAuth, JWT sessions,
  in-app Security PIN with short-lived elevation tokens
- Health records: daily records (water, meal, vital, mood, symptom, activity,
  note, sleep), dose logs, medicine reminders, allergies / conditions / current
  medicines
- AI pipeline: bounded-linear (Today analysis, Report summary, NL record
  candidates), agent-based assistant with source-split RAG, meal-analysis vision
  pipeline, SSE streaming
- Medicine knowledge: CN products + leaflet chunks, DrugBank drugs, medical QA
  corpus — three independent vector retrieval sources
- Data export: BullMQ async PDF export with inline fallback
- Infrastructure: Pino structured logging, AdminJS panel, Tencent COS uploads,
  full CI/CD via GitHub Actions

**What's missing**

- Production observability (metrics, dashboards, alerting)
- Push notification delivery (FCM / APNs)
- Audit logging
- Database backup strategy
- Rate limiting on AI endpoints
- Data retention and deletion policies
- Staging environment

---

## Directions

### Production Readiness → `v1.0.0`

Ship the first stable release.

- **Observability** — Prometheus metrics export, Grafana dashboards, alert
  rules, synthetic uptime monitoring
- **Backup & Recovery** — PostgreSQL scheduled backups, encrypted offsite
  storage, documented restore procedure
- **AI Rate Limiting** — per-user / per-endpoint Redis-backed throttling with
  configurable thresholds
- **Audit Logging** — `audit_logs` table for security-sensitive operations
  (password changes, identity binding, data exports, admin panel writes)
- **Quality Gate** — raise coverage thresholds, add AI safety policy edge-case
  tests, expand E2E coverage for critical user journeys

### Stability & Operations → `v1.1.0`

Keep the system running smoothly as usage grows.

- **Push Notifications** — FCM (Android) + APNs (iOS) integration, scheduled
  medicine reminder delivery, AI completion notifications, quiet hours
- **Staging Environment** — dedicated GitHub Environment, auto-deploy on main,
  data anonymization
- **Load Testing** — establish performance baselines (k6 / autocannon), document
  QPS / latency / concurrency limits
- **Data Retention & Privacy** — retention policies per data category, account
  deletion pipeline with cascade cleanup, anonymized data export
- **Dependency Security** — Dependabot / Renovate, `pnpm audit` in CI, base
  image patch tracking

### Feature Expansion → `v1.2.0`

Extend product capabilities on a stable foundation.

- **Assistant Enhancements** — conversation rename / delete / search, enhanced
  cross-conversation memory with user controls, new tools (medication safety
  check, trend analysis, reminder proposals)
- **Report Enhancements** — monthly / quarterly reports, period-over-period
  comparison, CSV and image export formats
- **Medicine Safety Rule Engine** — rule-based drug interaction checking,
  duplicate ingredient detection, allergy cross-checking, graded results
  consumable by the assistant
- **Food Data Pipeline** — incremental import support, alias management,
  meal-dish template quality scoring and lifecycle
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
