# lucent-db

Lucent 的 PostgreSQL 镜像：官方 `pgvector/pgvector:pg18` 基础上编译 zhparser。
三环境 compose 的 `postgres` 服务都用它。

## 构建

```bash
docker build -t lucent-db:18 docker/postgres
```

## 扩展集

| 扩展       | 来源                  | 用途                         |
| ---------- | --------------------- | ---------------------------- |
| `pgvector` | 基底镜像自带          | Lucent 自身向量检索          |
| `pg_trgm`  | PostgreSQL contrib    | 药品检索模糊匹配（迁移里建） |
| `zhparser` | 自建编译（SCWS 分词） | 中文药品检索的词边界切分     |

`zhparser` 的 `.so` 动态链接 SCWS（`/usr/local/lib/libscws.so`），
词典与规则在 `/usr/share/postgresql/18/tsearch_data/`。

## 启用扩展

扩展需在每个目标 database 中手动启用：

```sql
\c lucent
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS zhparser;   -- 需要时
```

LightRAG 的独立库（不进 Prisma 迁移域）同样需要 pgvector：

```sql
CREATE DATABASE lightrag;
\c lightrag
CREATE EXTENSION IF NOT EXISTS vector;
```

## AGE 已移除

Apache AGE 曾为本项目英文侧 OAG 的图后端。ADR-0022 将图后端改为 Neo4j 后，
AGE 在 2026-10-01 从本镜像、`compose.*.yaml` 与 Lucent 侧元数据中整体移除：

- 不再有 `age.so` / `age.control` / `age--1.7.0.sql`
- 不再有 `shared_preload_libraries=age`（原先的 CMD 已删除，用基底默认）
- 不再有 `lucent_graph` 库；图数据在 Neo4j 里，与 Postgres 完全独立

历史构建配方见 `docs/logs/migration-log/2026-09-19.md`（只读归档）。
