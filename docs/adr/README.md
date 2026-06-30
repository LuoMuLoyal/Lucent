# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for Lucent.

## What is an ADR?

An ADR captures a significant architectural decision, the context that led to it, the options considered, and the consequences. ADRs provide historical traceability for why the system is built the way it is.

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

| ADR                                      | Title                                         | Status   | Date       |
| ---------------------------------------- | --------------------------------------------- | -------- | ---------- |
| [0001](0001-nestjs-prisma-stack.md)      | NestJS + Prisma Stack                         | accepted | 2026-05-27 |
| [0002](0002-ai-pipeline-architecture.md) | AI Pipeline Three-Layer Architecture          | accepted | 2026-06-12 |
| [0003](0003-api-envelope-contract.md)    | API Envelope Contract                         | accepted | 2026-05-27 |
| [0004](0004-deployment-model.md)         | GitHub Actions + Tencent TCR Deployment Model | accepted | 2026-06-14 |
