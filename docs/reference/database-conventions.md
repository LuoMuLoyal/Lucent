---
status: active
owner: backend
quadrant: reference
updated: 2026-11-08
---

# 数据库设计规范

本文件是 `prisma/models/**` 的建模与命名约定。内容来源是成熟产品的公开规范，并结合
本仓 65 张表的实测现状裁决：**已经一致的部分固化为规则，尚未一致的部分标注为待办或明确豁免**。

参考来源：

- [GitLab: Ordering Table Columns in PostgreSQL](https://docs.gitlab.com/development/database/ordering_table_columns/) —— 列物理排序
- [GitLab: Constraints naming conventions](https://docs.gitlab.com/development/database/constraint_naming_convention/) —— 约束与索引命名
- [GitLab: Database Dictionary](https://docs.gitlab.com/development/database/database_dictionary/) —— 每张表的元数据登记
- [Bytebase: PostgreSQL SQL Review and Style Guide](https://www.bytebase.com/blog/postgres-sql-review-guide/) —— 综合审查清单

> 取用原则：以上规范大多面向「百万行级、DBA 治理、多数据库分片」的规模。本仓是单库
> 单租户的业务后端，**只采纳与当前规模相关、且能由代码或模型表达的条目**；分片 key、
> pgbouncer、在线 DDL、部署窗口等运维项不在此列。

---

## 一、命名

### 1.1 通用

| 规则                                       | 来源              | 本仓现状                                                 |
| ------------------------------------------ | ----------------- | -------------------------------------------------------- |
| 只允许小写字母、数字、下划线，首字符为字母 | Bytebase / GitLab | ✅ 65/65                                                 |
| 标识符 ≤ 63 字符（PostgreSQL 硬限制）      | Bytebase / GitLab | ✅ 最长 `user_suggestion_baseline_observations` 等均未超 |
| snake_case                                 | Bytebase          | ✅ 557 处 `@map` 全部一致                                |
| 禁止 SQL 保留字                            | Bytebase          | ✅ 无冲突                                                |
| 禁止 `$`、非英文字母、`pg` 开头            | Bytebase          | ✅                                                       |

### 1.2 表名

| 规则                                                      | 理由                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **模型名 PascalCase 单数**，`@@map` 为**复数 snake_case** | Prisma 惯例；复数表名是 SQL 主流（GitLab、Rails、Bytebase 均如此）                               |
| **与资源路径同名**                                        | `GET /layouts` → 表 `layouts`。表就是资源，两处不该用两套判断标准                                |
| **不加模块/域前缀**                                       | `accounts` 而非 `auth_accounts`。模块边界会变，表不会跟着改                                      |
| **用户私有表加 `user_` 前缀**                             | `user_settings`、`user_current_medicines`：一眼区分「按 user_id 隔离的私有数据」与「全局知识库」 |
| **全局知识表按数据源前缀**                                | `drugbank_*`（20 张）、`cn_*`、`medicine_*`                                                      |

**关于 `user_` 前缀的边界**（重要，容易误用）：

`user_` 表示**这条记录属于某个用户**。它**不**表示「表里有 user_id 列」——43 张无前缀的
表里也有带 `user_id` 的（`accounts`、`health_events`）。判断标准是**语义**：这条数据
离开用户是否还存在？

- `user_settings` / `user_layouts` → 不存在 → 带前缀
- `accounts` / `health_events` → 存在（账号是身份，事件是客观事实） → 不带

根实体 `users` 不需要前缀。

### 1.3 列名

| 规则                                              | 本仓现状                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| 模型侧 camelCase，`@map` 为 snake_case            | ✅ 557/557                                                                 |
| 主键统一叫 `id`                                   | ✅                                                                         |
| 外键 `<关联实体>Id` / `<entity>_id`               | ✅                                                                         |
| 时间列 `createdAt` / `updatedAt` / `deletedAt`    | ✅ 与 `created_time` 的 Bytebase 写法不同，本仓统一用 `_at`（Prisma 惯例） |
| 布尔列 `is*` / `has*` / `can*` / `requires*` 前缀 | ✅ 20/20（2026-11-08 完成标准化）                                          |

### 1.4 约束与索引命名

PostgreSQL 默认命名（`<表>_<列>_key`、`<表>_pkey`）**直接采用**，不手写约束名：

- Prisma 的 `@@unique` / `@@index` 生成的就是默认命名，与 PostgreSQL 一致；
- GitLab 的自定义前缀命名（`pk_` / `fk_` / `index_` / `unique_`）是为了在 Rails 无 ORM
  场景下可读，本仓由 Prisma 统一生成，手写反而会产生第二套命名。

**唯一必须显式的例外**：需要跨版本重命名或手工写迁移时，按 GitLab 的
`index_<table>_on_<columns>` 命名，避免默认名被 63 字符截断。

---

## 二、类型选择

### 2.1 时间

| 规则                                               | 本仓现状                       |
| -------------------------------------------------- | ------------------------------ |
| 时间点用 `timestamptz`，不用 `timestamp`（无时区） | ✅ 171 处 `@db.Timestamptz(3)` |
| 精度统一毫秒 `.000`                                | ✅ `(3)`                       |
| 纯日期（生日、报告日）用 `date`                    | ✅ 22 处 `@db.Date`            |
| 存 UTC，展示层转本地时区                           | ✅                             |

**为什么不建 `timestamp`**：`timestamp without time zone` 丢掉了时区信息，跨时区用户
（本产品有 `readUserTimezone`）一旦读出就无从判断基准。`timestamptz` 存瞬时点，是
Bytebase「Unify Time Zone」一条的直接落地。

### 2.2 枚举

固定且取值有限的列用 Prisma `enum`（映射为 PG 原生 enum），不用字符串或整数：

- 35 个枚举全部如此，✅ 一致；
- 优点：数据库层拦截非法值；缺点：加值需要迁移。**取值会频繁变化的列不要用 enum**，
  改用字符串 + 应用层校验。

### 2.3 JSON

`Json @db.JsonB` 用于**整块读取、从不按字段查询**的数据。本仓的判断依据写在模型注释里：

- ✅ 适合：`DrugbankDrug.pathways`（覆盖率 ~3%，整块展示）、`Layout.payload`（客户端自定义、
  服务端不解释）
- ❌ 不适合：需要按字段过滤/排序/连接的数据 —— 应提升为关系表

> 已有先例：DrugBank 的 `groups` / `synonyms` / `targets` 等原本是 JsonB，
> 2026-10 已由 `844a2442` 提升为关系表。**JsonB 是性能取舍，不是建模捷径。**

### 2.4 字符串

一律 `String`（映射 `text`），不加长度限制 —— PostgreSQL 中 `varchar(n)` 与 `text`
存储与性能完全相同，长度限制只应作为**业务规则**校验（放在 zod schema），
不应写在存储层。

### 2.5 主键

统一 `String @id @default(uuid())`。

**与 Bytebase「推荐 BIGINT 自增」的偏离及理由**：自增主键在分布式/离线同步场景下
会泄漏记录数量、且难以客户端预生成。本仓有离线队列（`pending_sync_queue`）与
多设备场景，UUID 带来的索引体积代价是可接受的。

---

## 三、约束与完整性

| 规则                                                   | 本仓现状                    |
| ------------------------------------------------------ | --------------------------- |
| 每张表必须有主键                                       | ✅ 65/65                    |
| 唯一性由数据库约束保证，不靠应用层                     | ✅                          |
| **正向 `@relation` 必须显式 `onDelete`**               | ✅ 全部关系均带             |
| 反向关系（列表侧）不写 `onDelete`                      | ✅                          |
| 外键动作要慎用 `Cascade`                               | ⚠️ 大量使用 `Cascade`，见下 |
| **表结构只由 Prisma 迁移创建**，应用代码与脚本不得 DDL | ✅ 2026-11-08 起            |

### 3.0 表结构的唯一来源

表结构的唯一来源是 `prisma/migrations/**`。**应用代码、导入脚本、运维脚本都不得执行
`CREATE TABLE` / `ALTER TABLE` / `CREATE TYPE`**。

早期 `scripts/import/medicine/import-medical-qa.ts` 曾用 `CREATE TABLE IF NOT EXISTS`
自建一张已由迁移管理的表（`scripts/sql/` 下当时还有一个被迁移取代后忘记删的遗留建表
脚本）。两者共同的危害是**漂移静默**：迁移改了列，脚本里的旧定义不会报错，新建环境会
建出老结构。二者已于 2026-11-08 清除。

脚本需要某张表时，正确的写法是**检查存在性并提示跑迁移**，而不是自己建：

```ts
const exists = await client.query(
  `SELECT to_regclass('public.medicine_qa_chunks') IS NOT NULL AS ok`,
);
if (!exists.rows[0]?.ok) {
  throw new Error('medicine_qa_chunks 不存在——先跑 pnpm db:migrate:all');
}
```

### 3.1 `onDelete` 的选法

| 场景                     | 动作               | 例                                                |
| ------------------------ | ------------------ | ------------------------------------------------- |
| 子记录离开父记录无意义   | `Cascade`          | `user_sessions`、`layouts` 随 `users` 删除        |
| 子记录应保留，仅解除关联 | `SetNull`          | `drugbank_drugs.import_run_id` 随导入批次删除置空 |
| 禁止删除仍有子记录的父   | `Restrict`（默认） | 未显式指定时                                      |

**当前全部是 `Cascade` 或 `SetNull`**，没有 `Restrict`。这是「用户注销即彻底删除其私有
数据」的产品决定的直接结果（合规要求），不是随手写的。新增表时按上表判断，不要默认
`Cascade`。

### 3.2 零值与 NULL

Bytebase 要求「语义上不区分零和 NULL 的列一律 `NOT NULL`」。本仓：
可空列都**有语义**（未设置 / 未知 / 未发生），例如 `lastLoginAt`（从未登录）、
`deletedAt`（未删除）。这部分与规范一致。

---

## 四、物理设计

### 4.1 列顺序（GitLab 的核心发现）

PostgreSQL 有类型对齐填充：`int4` 后接 `text` 会补齐 4 字节。因此**定长列在前、
变长列在后**能显著省空间。GitLab 实测在 8000 万行的表上省了 610 MB。

**本仓不强制**，原因是：

- Prisma 的列顺序由模型字段顺序决定，调整顺序需要重建表；
- 本仓最大的表是药品知识表（导入型，十万级），远未到该规模；
- 该优化应在**出现千万级表时**再针对单表重排。

> 如果将来某表超过 1000 万行，按 GitLab 的顺序重排：`timestamptz(8)` → `bigint(8)` →
> `int4(4)` → `bool(1)` → `text/jsonb`（变长垫底）。

### 4.2 宽表

Bytebase 以 15 列为界建议垂直拆分。本仓超过 15 列的表：

| 表                     | 列数 | 判断                                                              |
| ---------------------- | ---- | ----------------------------------------------------------------- |
| `drugbank_drugs`       | 52   | **接受**。导入型只读知识数据，几乎不 UPDATE，没有 MVCC 写放大问题 |
| `users`                | 43   | ⚠️ 偏高，但字段都是用户主体的高频读属性                           |
| `drugbank_structures`  | 38   | 接受（同上）                                                      |
| `drug_source_imports`  | 37   | 接受（导入批次元数据，低更新）                                    |
| `cn_medicine_leaflets` | 35   | 接受（同上）                                                      |

**判据不是列数，而是「是否频繁 UPDATE」**。宽表的风险来自 MVCC 写放大：每次更新都要
写整行。只读/低频更新的知识表不受此限制。新增**高频更新**的表时，若超过 15 列应拆分。

### 4.3 索引

| 规则                       | 本仓现状    |
| -------------------------- | ----------- |
| 每个查询路径都有对应索引   | ✅          |
| 不建未使用的索引           | 需定期审查  |
| 复合索引高基数列在前       | ✅ 基本遵守 |
| 不对大列建索引（>64 字符） | ✅          |

---

## 五、待办与豁免

### 5.1 明确豁免

| 规范                                              | 为什么不采用                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 约束自定义前缀命名（GitLab `pk_`/`fk_`/`index_`） | Prisma 统一生成默认命名，手写会产生第二套                                           |
| 列物理顺序优化（GitLab）                          | 未到千万级表规模，且 Prisma 调序需重建表                                            |
| 每表 YAML 元数据字典（GitLab）                    | 本仓 65 张表、单团队，模型注释已承载同等信息；引入 YAML 是纯开销                    |
| BIGINT 自增主键                                   | 见 §2.5，离线同步场景需要 UUID                                                      |
| 禁用外键（Bytebase 建议应用层保证）               | 本仓依赖 `Cascade` 做用户注销级联删除，去掉外键会让合规删除变成多次应用层查询且易漏 |

---

## 六、新增表检查清单

1. 表名复数 snake*case、与资源路径同名、按 §1.2 判断是否加 `user*` 前缀
2. 模型名 PascalCase 单数，`@@map` 到表名
3. `id String @id @default(uuid())`
4. 时间列 `@db.Timestamptz(3)`；纯日期用 `@db.Date`
5. `createdAt` 必加；可变更的实体加 `updatedAt`
6. 软删除用 `deletedAt`，查询走共享 `nonDeleted` helper（ADR-0009）
7. 所有正向 `@relation` 显式 `onDelete`，按 §3.1 选动作
8. 唯一性用 `@@unique` 表达，不靠应用层判断
9. 布尔列带 `is`/`has`/`can`/`requires` 前缀
10. 固定取值用 `enum`；整块读写的复杂结构用 `JsonB`，需按字段查询的一律建关系表
11. 迁移由 Prisma 生成；**应用代码与脚本不得 DDL**
12. 模型顶部写注释说明数据来源与归属模块（现有 12 个 `.prisma` 文件均如此）

---

## 与外部系统的 schema 隔离

第三方库自带的建表逻辑**不得写入 `public`**，必须放进独立 schema。

当前案例：`@langchain/langgraph-checkpoint-postgres` 的 `PostgresSaver.setup()` 会执行
`CREATE SCHEMA IF NOT EXISTS` 并建 4 张表（`checkpoints` / `checkpoint_blobs` /
`checkpoint_writes` / `checkpoint_migrations`）。它支持指定 schema：

```ts
// src/modules/assistant/infrastructure/agent/checkpointer.ts
new PostgresSaver(pool, undefined, { schema: 'langgraph' });
```

**不这样做会发生什么**：LangGraph 的表不在 Prisma 迁移历史里，`prisma migrate dev`
会报告「schema 漂移」并要求**重置整个数据库**。两个迁移系统不能共用 `public`。

判断归属：

| 情形                                            | 处理                                        |
| ----------------------------------------------- | ------------------------------------------- |
| 第三方库自己建表且自己迁移                      | 独立 schema                                 |
| 我们自己写的脚本建表，且表已在 Prisma schema 里 | 建表 SQL 移入 Prisma 迁移，删除脚本里的 DDL |
| 我们自己写的脚本建表，表不在 Prisma schema 里   | 补 Prisma 模型 + 迁移                       |
