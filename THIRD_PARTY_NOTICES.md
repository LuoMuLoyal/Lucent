# Third-Party Notices

Lucent itself is licensed under the [MIT License](LICENSE).

Lucent is built on third-party open-source software. This file records the components that ship in,
or are deployed alongside, a Lucent runtime, together with their licences. It records provenance.
It does not modify any upstream licence: each component remains under its own terms, and the
upstream `LICENSE` / `NOTICE` files inside each package are authoritative.

Version ranges below follow the repository manifests
(`package.json`, `pnpm-lock.yaml`, `compose.yaml`, `compose.monitoring.yaml`). Patch-level versions
move as dependencies are updated and are deliberately not pinned here; resolve the exact version
from the lockfile and the container image tag for any given checkout.

## Application dependencies

| Component                                                                                                                      | Used for                                                           | Licence          |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------- |
| [NestJS](https://nestjs.com) (`@nestjs/*`)                                                                                     | Application framework, DI, Fastify platform, Swagger               | MIT              |
| [Fastify](https://fastify.dev) + `@fastify/*`                                                                                  | HTTP server, CORS, Helmet, static assets, views                    | MIT              |
| [Prisma](https://www.prisma.io) (`prisma`, `@prisma/client`, `@prisma/adapter-pg`)                                             | Schema, migrations, type-safe data access                          | Apache-2.0       |
| [zod](https://zod.dev)                                                                                                         | Request / response validation and Standard Schema                  | MIT              |
| [RxJS](https://rxjs.dev)                                                                                                       | Reactive primitives used by NestJS                                 | Apache-2.0       |
| [reflect-metadata](https://github.com/rbuckton/reflect-metadata)                                                               | Decorator metadata runtime                                         | Apache-2.0       |
| [Passport](https://www.passportjs.org) + `passport-jwt`, [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken)            | Authentication strategies and JWT handling                         | MIT              |
| [argon2](https://github.com/ranisalt/node-argon2)                                                                              | Password hashing                                                   | MIT              |
| [otplib](https://github.com/yeojz/otplib)                                                                                      | One-time password primitives                                       | MIT              |
| [BullMQ](https://bullmq.io) + `bullmq-otel`                                                                                    | Job queues and queue tracing                                       | MIT              |
| [ioredis](https://github.com/redis/ioredis)                                                                                    | Redis client                                                       | MIT              |
| [Keyv](https://github.com/jaredwray/keyv) + `@keyv/redis`, [cache-manager](https://github.com/jaredwray/cache-manager)         | Cache abstraction                                                  | MIT              |
| [Winston](https://github.com/winstonjs/winston) + `nest-winston`, `winston-transport`                                          | Structured logging                                                 | MIT              |
| [pg](https://node-postgres.com)                                                                                                | PostgreSQL driver                                                  | MIT              |
| [LangChain](https://js.langchain.com) + [LangGraph](https://langchain-ai.github.io/langgraphjs/) (`langchain`, `@langchain/*`) | AI orchestration and agent runtime                                 | MIT              |
| [pdf-lib](https://pdf-lib.js.org) + `@pdf-lib/fontkit`                                                                         | PDF report generation                                              | MIT              |
| [Chart.js](https://www.chartjs.org)                                                                                            | Chart rendering for generated reports                              | MIT              |
| [Nodemailer](https://nodemailer.com)                                                                                           | Transactional mail                                                 | MIT-0            |
| [nestjs-i18n](https://github.com/toonvanstrijp/nestjs-i18n)                                                                    | Localised backend copy                                             | MIT              |
| [AdminJS](https://adminjs.co) + `@adminjs/fastify`, `@sergiyiva/adminjs-prisma`                                                | Embedded admin panel                                               | MIT              |
| [Scalar](https://scalar.com) (`@scalar/api-reference`, `@scalar/nestjs-api-reference`)                                         | API documentation UI at `/api/docs`                                | MIT              |
| [neverthrow](https://github.com/supermacro/neverthrow)                                                                         | Result types at the domain boundary                                | MIT              |
| [date-fns](https://date-fns.org)                                                                                               | Date arithmetic                                                    | MIT              |
| [yaml](https://github.com/eemeli/yaml)                                                                                         | YAML parsing for provisioned configuration                         | ISC              |
| [dotenv](https://github.com/motdotla/dotenv)                                                                                   | Environment file loading                                           | BSD-2-Clause     |
| [tslib](https://github.com/Microsoft/tslib)                                                                                    | TypeScript runtime helpers                                         | 0BSD             |
| [qrcode](https://github.com/soldair/node-qrcode)                                                                               | QR code rendering                                                  | MIT              |
| `@fontpkg/source-han-sans-sc-vf` (Source Han Sans SC VF / 思源黑体)                                                            | Embedded CJK font for generated PDFs                               | SIL OFL 1.1      |
| [OpenTelemetry](https://opentelemetry.io) (`@opentelemetry/*`)                                                                 | Traces, metrics and instrumentation                                | Apache-2.0       |
| `@prometheus-io/client`                                                                                                        | Prometheus metric exposition                                       | Apache-2.0       |
| `cos-nodejs-sdk-v5`, `ali-oss`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`                                          | Object storage clients (Tencent COS / Alibaba OSS / S3-compatible) | MIT / Apache-2.0 |

## Data stores, sidecars and infrastructure

These components run as separate processes or containers behind a network boundary. They are
deployed alongside Lucent but are not linked into, or redistributed as part of, the Lucent
application image.

| Component                                                                    | Used for                                                                                                  | Licence                                           |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [PostgreSQL](https://www.postgresql.org)                                     | Primary database                                                                                          | PostgreSQL License                                |
| [pgvector](https://github.com/pgvector/pgvector)                             | Vector index and similarity search                                                                        | PostgreSQL License                                |
| [zhparser](https://github.com/amutu/zhparser)                                | Chinese word segmentation for full-text search                                                            | PostgreSQL License                                |
| [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)               | Fuzzy matching                                                                                            | PostgreSQL License                                |
| [Redis](https://redis.io)                                                    | Cache and BullMQ backend                                                                                  | Redis 8 is tri-licensed: RSALv2 / SSPLv1 / AGPLv3 |
| [Neo4j Community Edition](https://neo4j.com)                                 | English-side OAG graph backend                                                                            | GPLv3                                             |
| [LightRAG](https://github.com/HKUDS/LightRAG)                                | Chinese prose retrieval sidecar                                                                           | MIT                                               |
| [Semantica](https://github.com/semantica-agi/semantica)                      | Ontology governance and deterministic reasoning library, used as the base of the English-side OAG sidecar | MIT                                               |
| [SeaweedFS](https://github.com/seaweedfs/seaweedfs)                          | Dev-only S3-compatible object storage (`pnpm dev:stack`)                                                  | Apache-2.0                                        |
| [VictoriaMetrics](https://victoriametrics.com), VictoriaLogs, VictoriaTraces | Metrics, logs and traces storage on the monitoring host                                                   | Apache-2.0                                        |
| [Grafana](https://grafana.com)                                               | Dashboards and unified alerting on the monitoring host                                                    | AGPLv3 (OSS edition)                              |
| [Jaeger](https://www.jaegertracing.io) (`all-in-one`)                        | Dev-only trace UI                                                                                         | Apache-2.0                                        |
| [prom/node-exporter](https://github.com/prometheus/node_exporter)            | Host-level metrics for the metrics stack                                                                  | Apache-2.0                                        |

### Components under strong copyleft

Three deployed components carry strong-copyleft terms. Each runs as an **independent container
process** reached over a network protocol, and none of them is compiled into, bundled with, or
redistributed as part of the Lucent application image or its MIT source release:

- **Neo4j Community Edition (GPLv3)**: the graph database. It is declared as its own compose
  service (`neo4j`) on a dedicated host, with its own image tag, memory limits and environment. The
  Semantica sidecar reaches it over Bolt; Lucent never links against it.
- **Grafana OSS (AGPLv3)**: dashboards and unified alerting, running on the monitoring host as its
  own container.
- **Redis 8**: tri-licensed under RSALv2, SSPLv1 and AGPLv3; deployers choose the terms that fit
  their situation.

This separation is a deployment boundary rather than a statement in a document. Every one of these
components has its own image, its own process, its own configuration file and its own upgrade
cycle, and can be swapped or removed without rebuilding Lucent.

## Development-only tooling

| Component                                                            | Used for                               | Licence          |
| -------------------------------------------------------------------- | -------------------------------------- | ---------------- |
| [TypeScript](https://www.typescriptlang.org), [SWC](https://swc.rs)  | Compilation and build                  | Apache-2.0 / MIT |
| [Vitest](https://vitest.dev)                                         | Unit and e2e test runner               | MIT              |
| [ESLint](https://eslint.org), [oxlint](https://oxc.rs)               | Linting                                | MIT              |
| [Prettier](https://prettier.io)                                      | Formatting                             | MIT              |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | Architecture dependency rules          | MIT              |
| [Compodoc](https://compodoc.app)                                     | Generated API documentation            | MIT              |
| [Trivy](https://trivy.dev)                                           | Container vulnerability scanning in CI | Apache-2.0       |
| [commitlint](https://commitlint.js.org)                              | Commit message convention              | MIT              |
| [simple-git-hooks](https://github.com/toplenboren/simple-git-hooks)  | Local git hook installation            | MIT              |

## Data sources

Drug knowledge in Lucent is imported from the **DrugBank** dataset (academic use) and from public
Chinese medicine datasets. These are data sources rather than software dependencies: they are
imported by Lucent's own pipeline, cleaned and filtered on the way in, and are not redistributed
with the source release. Their respective terms of use apply to the data itself.

## Reporting

If you believe a component is listed with the wrong licence, or a component is missing, please open
an issue. Licence corrections are treated as documentation defects.
