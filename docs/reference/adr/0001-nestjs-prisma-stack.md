# ADR-0001: NestJS + Prisma Stack

- **Status**: accepted
- **Date**: 2026-05-27
- **Deciders**: LuoMuLoyal

## Context

Luminous needed a backend to replace the legacy `Luminous/backend`. The backend must support REST
APIs with JWT auth, WeChat OAuth, PostgreSQL for structured health/medicine data, Redis for caching
and job queues, and an AI pipeline for health analysis and assistant features.

## Decision

Use NestJS 11 as the application framework, Prisma 7 as the ORM, PostgreSQL as the primary
database, and Redis for caching and BullMQ queues.

## Options Considered

| Option            | Pros                                                                                                | Cons                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| NestJS + Prisma   | Strong TypeScript support, module system, guards/interceptors, OpenAPI generation, mature ecosystem | Learning curve for NestJS decorator pattern                       |
| Express + TypeORM | Simpler mental model, widely known                                                                  | Less structure for growing codebase, TypeORM maintenance concerns |
| Fastify + Knex    | High performance, query-builder flexibility                                                         | Less ecosystem for auth/OAuth, manual OpenAPI                     |

## Consequences

- Module-based architecture with clear boundaries enforced by NestJS module system
- Prisma schema as single source of truth for database models
- Auto-generated AdminJS panel from Prisma schema
- OpenAPI generation from controller decorators via `@nestjs/swagger`
- Prisma 7 requires `prisma-client` provider (not `prisma-client-js`)
