# Apache AGE 图扩展引入计划

Created: 2026-09-27
状态：待评审（未开工）
定位：为 Semantica OAG（英文侧本体增强生成）引入 **Apache AGE** 图查询扩展，使其能在 PostgreSQL 18 上运行 Cypher 图查询。**AGE 只服务英文侧 OAG；LightRAG 保持 `PGTableGraphStorage`（纯 SQL 表，不需要 AGE）。**

---

## 一、决定与边界

| #   | 决定                             | 内容                                                                                                                                                                                                                                                                               |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **AGE 是英文侧 OAG 的图后端**    | Semantica 的决策/审批/策略层发 Cypher 查询，必须有 LPG 服务；AGE 与 pgvector 已编译进所采用的 `dyingbleed/postgres-rag:18-trixie` 镜像，不引入 Neo4j 等外部服务                                                                                                                    |
| 2   | **版本钉死 1.7.0**               | `apache/age#2500`（open，2026-08-07）：1.8.0 引入原生 vertex/edge 类型后 `id()` 返回 `graphid`（pass-by-value int64），`agtype_in_operator` 仍按 varlena 指针解引用，`WITH [1] AS ids MATCH (n) WHERE id(n) IN ids` 直接 SIGSEGV 并触发 PG 崩溃恢复。`release/PG18/1.7.0` 不受影响 |
| 3   | **独立 database**                | AGE 会执行 `CREATE EXTENSION IF NOT EXISTS age` + `SET search_path = ag_catalog`，必须用独立 database（如 `lucent_graph`），不污染 Prisma 域                                                                                                                                       |
| 4   | **LightRAG 不用 AGE**            | LightRAG 的存储实现加文档后不可更换，绑上 AGE 等于把 AGE 的版本生命周期绑进检索层数据。LightRAG 继续用 `PGTableGraphStorage`（纯 SQL 表）                                                                                                                                          |
| 5   | **dev/test/prod 三环境同一形态** | 共享 PG18 镜像 + AGE 扩展；dev/test 用独立 database，prod 用独立 database                                                                                                                                                                                                          |
| 6   | **不引入新容器**                 | 三环境改用现成镜像 `dyingbleed/postgres-rag:18-trixie`（PG18 + pgvector 0.8.1 + AGE 1.7.0）；不新建独立的 AGE 容器                                                                                                                                                                 |
| 7   | **不改 Prisma schema**           | AGE 的图表（`ag_*`）由 AGE 扩展自动管理，不进 Prisma 迁移域                                                                                                                                                                                                                        |

---

## 二、现状（2026-09-27 核实）

### 2.1 PG 镜像

| 环境 | 镜像                                | 数据库                  |
| ---- | ----------------------------------- | ----------------------- |
| dev  | `dyingbleed/postgres-rag:18-trixie` | `lucent`（POSTGRES_DB） |
| test | `dyingbleed/postgres-rag:18-trixie` | `lucent`                |
| prod | `dyingbleed/postgres-rag:18-trixie` | `lucent`                |

三环境均使用 `dyingbleed/postgres-rag:18-trixie`，**pgvector 0.8.1 + AGE 1.7.0 已编译进镜像，但扩展未在数据库级别启用**（需手动 `CREATE EXTENSION`）。

### 2.2 AGE 版本选择

- `release/PG18/1.7.0`：最后 tag `PG18/v1.7.0-rc0`（2026-08-07），Docker Hub 目前没有 PG18 1.8.0 镜像
- 1.8.0 问题：`apache/age#2500`（open）—— 原生 vertex/edge 类型引入后 `id()` 返回 `graphid`，与 `IN` 操作符不兼容，导致 SIGSEGV
- **结论**：钉 `release/PG18/1.7.0`，升级前先看 #2500 状态

### 2.3 Semantica 的 AGE 使用方式

- `DBIngestor` 直连 PG 拉取 DrugBank 结构化数据建 KG
- 决策/审批/策略层发 Cypher 查询（必须有 AGE）
- AGE adapter 会自己执行 `CREATE EXTENSION IF NOT EXISTS age` → 需要扩展创建权限
- `SET search_path = ag_catalog` → 建议用独立 database，避免污染 Prisma 域

### 2.4 不受影响的部分

| 组件               | 影响                                                           |
| ------------------ | -------------------------------------------------------------- |
| LightRAG           | **不受影响**—— 用 `PGTableGraphStorage`（纯 SQL 表），不碰 AGE |
| 现有 DrugBank 检索 | **不受影响**—— 走 pgvector passage 检索（`mode=naive` 语义）   |
| Prisma schema      | **不受影响**—— AGE 图表由 AGE 扩展管理                         |
| 中文侧             | **不受影响**—— 不引入 Semantica（§5.6 硬缺陷）                 |

---

## 三、目标形态

### 3.1 镜像选型

直接用现成镜像 **`dyingbleed/postgres-rag:18-trixie`**（Docker Hub），不再自建 Dockerfile：

- 基底 `postgres:18-trixie`，从源码编译 pgvector **0.8.1** + Apache AGE **1.7.0**（`PG18/v1.7.0-rc0`，避开 #2500 SIGSEGV）
- 版本钉死 `18-trixie` 标签（不可变 release），不用 `latest`（跟随 main 分支，不可复现）
- 扩展需在每个目标 database 中手动启用：`CREATE EXTENSION IF NOT EXISTS vector;` + `CREATE EXTENSION IF NOT EXISTS age;`
- 若需自行审计/重建，Dockerfile 见 https://github.com/dyingbleed/postgres-rag

### 3.2 数据库隔离（每个环境独立 database）

| 环境 | AGE database   | 用途                               |
| ---- | -------------- | ---------------------------------- |
| dev  | `lucent_graph` | AGE 图查询（Semantica sidecar 用） |
| test | `lucent_graph` | AGE 图查询（e2e 测试用）           |
| prod | `lucent_graph` | AGE 图查询（Semantica sidecar 用） |

**独立 database 的理由**：

- AGE 扩展的 `search_path = ag_catalog` 会污染查询解析
- 避免 AGE 图表与 Prisma 表在同一 schema 下冲突
- AGE 的图数据与业务数据物理隔离，便于独立备份/恢复

### 3.3 权限设计

```sql
-- 在 lucent_graph 数据库中
CREATE EXTENSION IF NOT EXISTS age;

-- 为 Semantica sidecar 创建专用角色
CREATE ROLE semantica WITH LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE lucent_graph TO semantica;
GRANT USAGE ON SCHEMA ag_catalog TO semantica;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ag_catalog TO semantica;
```

### 3.4 compose 编排（三环境）

```yaml
# compose.dev.yaml / compose.staging.yaml / compose.yaml
services:
  postgres:
    image: dyingbleed/postgres-rag:18-trixie # pgvector 0.8.1 + AGE 1.7.0
    # ... 其他配置不变
    environment:
      POSTGRES_DB: lucent # Prisma 用这个
    # AGE database 在 entrypoint 中创建
    command: >
      postgres
        -c shared_preload_libraries='age'
        -c log_min_duration_statement=500

  # entrypoint 中添加：
  # createdb -U postgres lucent_graph || true
  # psql -U postgres -d lucent_graph -c "CREATE EXTENSION IF NOT EXISTS age;"
```

---

## 四、配置

### 4.1 Lucent 侧（新增 EnvKey）

| Key                | 默认         | 说明                                                                                        |
| ------------------ | ------------ | ------------------------------------------------------------------------------------------- |
| `AGE_ENABLED`      | `false`      | 关闭时 Semantica 工具返回"未配置"信封                                                       |
| `AGE_DATABASE_URL` | —            | AGE 图查询的独立 database URL（如 `postgresql://postgres:...@localhost:5432/lucent_graph`） |
| `AGE_SEARCH_PATH`  | `ag_catalog` | AGE schema 搜索路径                                                                         |

落点：`src/config/env/env-keys.enum.ts`、`src/config/env/environment.validation.ts`、`docs/reference/environment-variables.md`、`.env.production.example`、`compose*.yaml`。

### 4.2 AGE 扩展配置（PG 侧）

```sql
-- postgresql.conf
shared_preload_libraries = 'age'

-- 在 lucent_graph 数据库中
CREATE EXTENSION IF NOT EXISTS age;
SET search_path = ag_catalog, "$user", public;
```

---

## 五、落地顺序与验收

| 阶段   | 工作量 | 内容                                                                          | 验收                                                                                           |
| ------ | ------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **P0** | 0.5 天 | 拉取并实测 `dyingbleed/postgres-rag:18-trixie`（PG18 + pgvector + AGE 1.7.0） | `docker pull` 成功，`CREATE EXTENSION age;` 后 `SELECT * FROM ag_catalog.ag_graph;` 返回空结果 |
| **P1** | 0.5 天 | 三环境 compose 编排（dev/test/prod）+ 独立 database 创建                      | 三环境 `pg_isready` 通过，`SELECT * FROM pg_extension WHERE extname = 'age';` 返回 1 行        |
| **P2** | 1 天   | Semantica sidecar 部署（fork 版 + curated extras）+ AGE 后端配置              | sidecar 启动成功，`CREATE (n:Test {name: 'hello'}) RETURN n;` 返回结果                         |
| **P3** | 1 天   | DrugBank 数据灌入 Semantica（`DBIngestor` 直连 PG）                           | 多跳查询（药→靶点→相互作用药）返回正确结果                                                     |
| **P4** | 1 天   | Lucent 新增 `reason_over_ontology` 工具 + 注册                                | 工具调用返回带 PROV-O 溯源的 envelope                                                          |
| **P5** | 0.5 天 | 文档 + 迁移日志                                                               | `pnpm docs:verify` / `docs:links` 通过                                                         |

---

## 六、风险与应对

| 风险                       | 事实                                                        | 应对                                                                                    |
| -------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **AGE 1.8.0 SIGSEGV**      | `apache/age#2500`（open）：`id(n) IN <list>` 导致 PG 崩溃   | 钉 `release/PG18/1.7.0`；升级前先看 #2500 状态                                          |
| **AGE 版本与 PG 版本绑定** | AGE 的 release 按 PG major version 分支                     | 锁定 PG18；AGE 升级需换用新镜像                                                         |
| **AGE 扩展创建权限**       | Semantica 的 AGE adapter 会自己执行 `CREATE EXTENSION`      | 需要超级用户权限创建扩展，或提前手动创建                                                |
| **AGE 功能矩阵限制**       | AGE 后端的 Reasoning/analytics 与 Provenance 只标 `Partial` | 接受局限；关键查询先实测再决定                                                          |
| **第三方镜像供应链**       | `dyingbleed/postgres-rag` 是社区镜像，维护持续性未知        | 钉 `18-trixie` 不可变标签；上线前审计 Dockerfile 与镜像层；必要时以同一配方自建镜像回退 |

---

## 七、文档动作

- `src/modules/medicines/README.md`：登记 AGE 扩展与 `lucent_graph` 数据库
- `docs/reference/environment-variables.md`：新增 AGE 相关环境变量
- `docs/reference/deployment.md`：登记 `dyingbleed/postgres-rag:18-trixie` 镜像选型与启用扩展的步骤
- 当日迁移日志

**不建 ADR**：决策记在本计划 + 模块 README + 迁移日志。

---

## 八、待确认

1. **`dyingbleed/postgres-rag:18-trixie` 的镜像可信度**：P0 先实测镜像内容（AGE/pgvector 版本、是否含非预期文件）；不达标则按同一配方（见仓库 Dockerfile）自建镜像
2. **Semantica sidecar 的部署位置**：是与 Lucent 同一 compose stack，还是独立部署？
3. **`lucent_graph` 数据库的备份策略**：是否需要独立备份，还是随主库一起备份？
