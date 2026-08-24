# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for Lucent.

## What is an ADR?

An ADR captures a significant architectural decision, the context that led to it, the options
considered, and the consequences. ADRs provide historical traceability for why the system is built
the way it is.

## Naming

```
NNNN-lowercase-title-with-dashes.md
```

- `NNNN`: sequential number, zero-padded (0001, 0002, ...)
- Title: short, descriptive, kebab-case

## Status Values

- `proposed` — under discussion, not yet implemented
- `accepted` — approved and implemented (or planned for implementation)
- `deprecated` — replaced by a newer ADR; reference the superseding ADR
- `superseded` — no longer applicable

## Template

```markdown
# ADR-NNNN: Title

- **Status**: proposed | accepted | deprecated | superseded
- **Date**: YYYY-MM-DD
- **Deciders**: [list]

## Context

What is the issue or decision point? What constraints or forces are at play?

## Decision

What did we decide to do?

## Options Considered

| Option   | Pros | Cons |
| -------- | ---- | ---- |
| Option A | ...  | ...  |
| Option B | ...  | ...  |

## Consequences

What becomes easier or harder as a result of this decision?
```

## Index

- [0001](0001-nestjs-prisma-stack.md)
  - Title: NestJS + Prisma Stack
  - Status: accepted
  - Date: 2026-05-27
- [0002](0002-ai-pipeline-architecture.md)
  - Title: AI Pipeline Three-Layer Architecture
  - Status: accepted
  - Date: 2026-06-12
- [0003](0003-api-envelope-contract.md)
  - Title: API Envelope Contract (historical; fully superseded by 0012)
  - Status: superseded by 0012
  - Date: 2026-05-27
- [0004](0004-deployment-model.md)
  - Title: GitHub Actions + Tencent TCR Deployment Model
  - Status: accepted (amended 2026-07-17: blue-green → single-slot downtime deploy)
  - Date: 2026-06-14
- [0005](0005-meal-analysis-write-time-pipeline.md)
  - Title: Write-Time Meal Analysis With Imported Food Composition Data
  - Status: accepted
  - Date: 2026-06-17
- [0006](0006-observability-strategy.md)
  - Title: Observability Strategy — prom-client + Prometheus/Grafana, Defer OpenTelemetry
  - Status: accepted
  - Date: 2026-07-09
- [0007](0007-logging-pino-to-winston.md)
  - Title: Logging Framework — Pino → Winston Migration
  - Status: accepted
  - Date: 2026-07-12
- [0008](0008-no-cn-drugbank-medicine-mapping.md)
  - Title: No CN ↔ DrugBank Medicine Cross-Source Mapping
  - Status: accepted
  - Date: 2026-07-15
- [0009](0009-cross-module-data-access.md)
  - Title: 跨模块数据访问治理（表归属 + 读/写规则 + 提供方 reader port）
  - Status: accepted
  - Date: 2026-07-17
- [0010](0010-otel-tracing.md)
  - Title: Full-Stack Tracing — OpenTelemetry + Jaeger, Retire requestId
  - Status: accepted
  - Date: 2026-08-01
- [0011](0011-reminder-delivery-at-least-once.md)
  - Title: Reminder 投递去重的至少一次语义（唯一约束部分已被 0013 修订）
  - Status: accepted
  - Date: 2026-08-03
- [0012](0012-error-contract-and-result-boundary.md)
  - Title: Error Contract and Result Boundary
  - Status: accepted
  - Date: 2026-08-18
- [0013](0013-reminder-delivery-three-channel.md)
  - Title: 提醒投递记录三通道落库（in_app / local / push）
  - Status: accepted
  - Date: 2026-08-16
- [0014](0014-object-storage-provider-abstraction.md)
  - Title: Object Storage Provider Abstraction
  - Status: accepted
  - Date: 2026-08-17
- [0015](0015-config-yaml-coolify-traefik-migration.md)
  - Title: .env → YAML Configuration + Coolify/Traefik Deployment + VictoriaMetrics
  - Status: accepted
  - Date: 2026-08-24
