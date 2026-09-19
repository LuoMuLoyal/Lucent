# lucent-db

Lucent 的 PostgreSQL 镜像：官方 `pgvector/pgvector:pg18` 基础上编译 Apache AGE。
三环境 compose 的 `postgres` 服务都用它。

它**首先是 Lucent 的主库**，AGE 只是额外带的扩展——图数据存在独立 database
`lucent_graph` 里，与 Prisma 域隔离。命名反映定位而非扩展集，将来增删扩展不必改名。

## 构建

```bash
docker build -t lucent-db:18 docker/postgres-age
```

标签只写 PG major（`18`）。AGE 版本由构建参数 `AGE_REF` 决定，生产用短 sha
标签保证可复现（同 `LUCENT_IMAGE` 的做法），因此不必把扩展版本拼进标签。

换 AGE 版本：

```bash
docker build --build-arg AGE_REF=PG18/v1.7.0-rc0 -t lucent-db:18 docker/postgres-age
```

## AGE 钉死 1.7.0

`apache/age#2500`（open）：1.8.0 引入原生 vertex/edge 类型后 `id()` 返回
`graphid`，而 `agtype_in_operator` 仍按 varlena 指针解引用，
`id(n) IN <list>` 直接 SIGSEGV 并触发 PG 崩溃恢复。
**升级前必须先确认 #2500 已修复。**

## 为什么自建

AGE 引入计划原拟直接用社区镜像 `dyingbleed/postgres-rag:18-trixie`，但该镜像
**仅发布 `arm64/linux`**，而三环境均为 amd64，无法运行。故按同配方自建，
基底换用官方 `pgvector/pgvector:pg18`（已含 pgvector），只编译 AGE。

## 启用扩展

扩展需在每个目标 database 中手动启用：

```sql
CREATE DATABASE lucent_graph;                                    -- 独立 database
\c lucent_graph
CREATE EXTENSION IF NOT EXISTS age;
```

独立 database 的理由：AGE 的 adapter 会 `SET search_path = ag_catalog`，
同库会污染 Prisma 域。

`lucent` 库需要 pgvector：

```sql
\c lucent
CREATE EXTENSION IF NOT EXISTS vector;
```
