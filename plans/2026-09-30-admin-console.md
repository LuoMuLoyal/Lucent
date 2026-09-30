# Lucent 管理后台（Admin Console）实施计划

> **状态：待裁决（DRAFT — not approved for execution）**
>
> 三项未裁决项已于 2026-09-30 裁决完毕（见「裁决结论」），Phase R 的 R-pre 探查
> 亦已完成并产出结论（含一条对 Docker 路线的**重大发现**）。**当前状态：待复审。**
>
> 本文件包含一次仓库形态变更（Phase R：单包 → monorepo）。Phase R 的路径引用按
> **目标布局**书写。

## 裁决结论（2026-09-30）

| 项                            | 裁决                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| **U1** `scripts/` 归属        | **分层**：`docs/`、`dev/`、`shared/` 留根（仓库级）；`arch/`、`contract/`、`import/` 随 api 走 |
| **U2** 是否加 R-pre           | **加**，且已执行完毕（见下）                                                                   |
| **U3** refine-ui 组件覆盖策略 | **先装后恢复** + 名单写入 `apps/admin/README.md`；`separator` 例外（见下）                     |

### U3 的例外：`separator` 不是定制，是版本落后

已核实 `separator.tsx` 的 shadcn-admin 版与 shadcn 官方 registry 版的仅有一处差异：

```diff
- data-[orientation=vertical]:w-px                            // shadcn-admin
+ data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px   // 官方
```

**shadcn-admin 只是删掉了 `h-full`，官方新版才是对的。** 这不是"要保护的定制"，
而是**应被覆盖的落后实现**。shadcn-admin README 把它列入 "Modified Components" 有误导性。

**故 U3 的执行方式修正为**：安装 refine-ui 组件前，**逐个原语比对** shadcn-admin 版与
官方 registry 版，区分「真定制」与「版本落后」两类，只恢复前者。

已确认的真定制样本——`scroll-area.tsx`（含 `orientation` prop、`overflow-x-auto!`、
`transition-colors`）：**必须保护**。

**这项逐个比对是 Phase 3a 的前置工作，不可跳过。**

## R-pre 探查结论（2026-09-30，已执行）

在隔离目录（工作区外一次性探针，已清理）模拟了 `apps/api` workspace 化，**未改动任何
仓库文件**。三个关键结论：

**① `overrides` 在 workspace 下仍生效** ✅

```
pnpm why fastify → fastify@5.12.5（单一版本，与基线一致）
```

`overrides.fastify` 的钉版（消除双副本导致的 `FastifyInstance` 名义类型不兼容）
**在 workspace 下依然成立**。U2 最大的风险点排除。

**② `pnpm prune --prod` 语义已变** ⚠️

|                  | 单包（现状）        | workspace（目标）                          |
| ---------------- | ------------------- | ------------------------------------------ |
| devDeps 移除位置 | `/app/node_modules` | `apps/api/node_modules`                    |
| 包实体残留       | 无                  | **`/app/node_modules/.pnpm`（约 950 MB）** |

prune 仍会从 `apps/api/node_modules` 移除 devDeps，但**实体的剪枝范围变了**。

**③ node_modules 布局根本不同** ⚠️⚠️ **（本次探查最重要的发现）**

```
单包:        /app/node_modules/            ← 依赖实体与链接都在此
workspace:   /app/node_modules/.pnpm/      ← 实体在此（约 950 MB）
             /app/apps/api/node_modules/   ← 仅符号链接在此
```

**Dockerfile 第 78 行 `COPY --chown --from=builder /app/node_modules ./node_modules`
在 workspace 下只拷贝 `.pnpm` 实体，不含 `apps/api/node_modules` 的链接** →
运行时模块解析将失败。

**且那 7 条镜像瘦身逻辑全部按单包路径写死**
（`node_modules/.pnpm/@prisma+client@*/...`、`node_modules/.pnpm/@fontpkg+...` 等），
workspace 下需整体重算。

**结论：Phase R3-G（Docker）的风险等级从"高"上调为"最高"，且不再是"改 5 条 COPY
路径"的量级。** 镜像体积可能**不减反增**。`pnpm deploy --prod` 可能是正解
（从 workspace 生成自包含的 prod-only 目录），但**需单独验证后才可写入 R3-G**。

**R-pre 的净收益**：用一个隔离探针，在不触碰仓库的前提下，提前发现了这个会让
Docker 构建"看起来成功、运行时报模块缺失"的陷阱。若按原计划直接上 R1，代价是一次
全仓搬迁加上一个只在容器里才暴露的故障。

## 修订记录

| 日期       | 修订                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-30 | 初稿                                                                                                                                              |
| 2026-09-30 | **复审后大修**：删除不存在的 `@refinedev/tanstack-router` 方案；修正 refine-ui target 事实；重做 scripts 清单；补 monorepo 归属裁决；表栈裁决落地 |

**本次修订纠正的初稿错误**（留档，避免重蹈）：

1. 初稿决策 3 第 4 条与 Phase 3a 建立在 `@refinedev/tanstack-router` 之上。
   **该包在 npm 上是 404，从未发布。** 唯一相关产物是 Refine PR #6919
   （2025-12-29 关闭未合并），其正文自陈 "Refine doesn't include built-in support
   for TanStack Router"。初稿写"先验证成熟度"是无效动作——不是不成熟，是不存在。
2. 初稿称 refine-ui 与 shadcn-admin "两个 registry 会往同一个 `src/components/ui/` 写"。
   **错误。** 已核实 refine-ui 的 registry `target` 是 `src/components/refine-ui/...`。
3. 初稿 R3-C 称"6 处硬编码根，逐一核实"。**该数字与清单均不成立**：所列 6 条中 2 条
   路径不存在，且 6 条只是真实集合的一部分（实际 14 个文件持有仓库根常量）。
4. 初稿 R2 写"根新建/加 `packages` 字段"。**`pnpm-workspace.yaml` 已存在**于 Lucent 根
   （含 `allowBuilds`/`minimumReleaseAgeExclude`/`overrides.fastify`），Dockerfile
   第 9/18 行已在 COPY 它。当前已是单成员 workspace 形态，应写"修改现有文件"。
5. 初稿未处理与 `plans/2026-08-14-saas-modules-and-node-monorepo.md` 的冲突。

---

## 未裁决项 —— 已全部裁决（保留下文作为裁决依据）

### U1 —— `scripts/` 归属【已裁决：分层】

核实发现 `scripts/` **同时依赖根配置与被搬迁的目录**：

```jsonc
// scripts/tsconfig.json
{
  "extends": "../tsconfig.json", // ← 指向根 tsconfig
  "rootDir": "..", // ← 根目录
  "include": ["./**/*.ts", "../prisma/fix-generated-prisma-internal.ts"],
} // ↑ 跨到 prisma/（将搬入 apps/api/）
```

`scripts` 当前是**根级工具目录**，但它 include 了 `prisma/`。若 `prisma/` 搬入
`apps/api/` 而 `scripts/` 留在根，此处断裂。

**`REPO_ROOT` 在 scripts 内至少有四种不同语义**，搬迁后各自指向不同目标：

| 文件                                      | 用法                            | 真实语义           | 搬迁后目标                 |
| ----------------------------------------- | ------------------------------- | ------------------ | -------------------------- |
| `shared/env.ts`                           | `path.join(REPO_ROOT, envPath)` | 跟着 `.env` 走     | `apps/api/`（.env 随 api） |
| `dev/up-local-stack.ts`                   | `REPO_ROOT/compose.dev.yaml`    | 跟着编排文件走     | **根**（compose 留根）     |
| `dev/start-test-runtime.ts`               | `REPO_ROOT/.runtime-test.pid`   | 跟着运行时状态走   | **根**                     |
| `import/medicine/*.ts`                    | `REPO_ROOT/../DrugDataBase`     | 跟着仓库物理位置走 | 需重算层级                 |
| `docs/*.ts`、`arch/*.ts`、`contract/*.ts` | 扫描 `src/`、`docs/`、`prisma/` | 混合               | 需逐个裁决                 |

**裁决：分层（U1-D），不整体搬也不整体留。** `scripts/` 按**职责**而非位置划分：

| 子目录      | 归属       | 理由                                                        |
| ----------- | ---------- | ----------------------------------------------------------- |
| `docs/`     | **留根**   | 仓库级门禁：检查 `docs/`、`plans/`、模块 README，这些都在根 |
| `dev/`      | **留根**   | 操作 `compose*.yaml`、`.runtime-test.pid`，均在根           |
| `shared/`   | **拆分**   | `env.ts` 的 `.env` 解析归 api；其余工具归根                 |
| `arch/`     | **随 api** | 扫描 `src/**/*.controller.ts` 与 `src/modules`，纯 api 级   |
| `contract/` | **随 api** | `export-openapi.ts` 读 `src/modules` 与 prisma schema       |
| `import/`   | **随 api** | 依赖 prisma client 与 `DrugDataBase` 相对路径               |
| `spike/`    | **待定**   | 一次性验证代码，随其依赖走                                  |

**`scripts/tsconfig.json` 的处理**：拆为两份——根 `scripts/tsconfig.json`（覆盖留根部分，
`extends ./tsconfig...` 指向新的 api tsconfig 需按实际路径定）与 `apps/api/scripts/tsconfig.json`。
**该拆分需在 R1 前定稿为具体文件清单**，否则 R3-D 无法并行。

**新增具名常量约定**（替代 `REPO_ROOT` 的四义混用）：

```
REPO_ROOT      仓库根（workspace root）——给 compose / pid / docs 扫描
API_ROOT       apps/api ——给 .env 解析 / prisma
WORKSPACE_ROOT 同 REPO_ROOT，显式命名以区分语义（给 DrugDataBase 相对层级）
```

### U2 —— 是否加 R-pre【已裁决：加，且已执行完毕】

初稿假定"搬迁是纯机械操作"不成立。**裁决：加 R-pre，并已在本日执行完毕**，
结论见文首「R-pre 探查结论」。**净收益**：在不触碰仓库的隔离探针里提前发现了
workspace 下 node_modules 布局变化会让 Docker 构建"看起来成功、运行时报模块缺失"。

### U3 —— refine-ui 组件覆盖策略【已裁决：先装后恢复】

已核实 `refine-ui/data-table.json` 的 `registryDependencies`：

```json
[
  "table",
  "button",
  "input",
  "badge",
  "popover",
  "command",
  "separator",
  "calendar",
  "select"
]
```

对照 shadcn-admin README 自陈的定制清单：

| 原语                                        | shadcn-admin 自陈状态    |
| ------------------------------------------- | ------------------------ |
| `table` / `command` / `calendar` / `select` | RTL Updated              |
| `separator`                                 | **Modified**（非仅 RTL） |

**9 个中有 5 个会被 shadcn CLI 静默覆盖。** 不是冲突报错，是无声覆盖。

**裁决：先装后恢复。** 但因已发现 `separator` 实为"版本落后"而非定制
（见文首 U3 例外），执行方式修正为：

1. **安装前**：逐个原语比对 shadcn-admin 版与 shadcn 官方 registry 版
2. **分类**：区分「真定制」（如 `scroll-area`）与「版本落后」（如 `separator`）
3. **只恢复前者**；后者接受官方版覆盖
4. **名单写入 `apps/admin/README.md`**，后续每次 `shadcn add` 后按名单核对

**注意**：因决策 4 已裁定不引入 refine-ui 的 `data-table`，该组件的 9 项
`registryDependencies` **不会触发**。实际需处理的只有 `views.json` 的依赖
（`separator`、`buttons`、`breadcrumb`、`loading-overlay`）。

---

## 背景

`src/admin/` 现有的 AdminJS 面板通过 `@sergiyiva/adminjs-prisma` 自省 Prisma DMMF，
为**每个 model 自动生成 resource**（`services/resource-builder.service.ts`），写操作直接
打到 Prisma client。

对 Lucent 而言这不只是"不是 dashboard"，而是三类具体问题：

1. **绕过业务逻辑与审计**。AdminJS 写操作绕过所属模块 service，也绕过 `AuditLogService`。
   `src/modules/audit-log/README.md` 自陈边界为「不管：审计数据的查询/展示端点（当前不存在）」
   ——有写入，没有读出口。
2. **医疗健康数据无差别可写**。`UserDailyRecord`、`UserMedicineDoseLog`、`UserCondition`、
   `UserAllergy` 等属敏感个人信息，一个能静默改写的面板不应作为日常管理入口。
3. **管理员身份仅靠单一环境变量**。`AdminGuard` 头注释自陈
   「the only admin identity is the `ADMIN_EMAIL` env credential / The repo has no role
   column and no API admin guard」。无角色、无权限分级、无法追溯"谁改的"。

同时存在真实**能力缺口**：`legal-documents` 与 `medicine-safety-tips` 目前**没有任何写端点**
（`legal-documents.controller.ts` 是 `@Public()` + 纯 `@Get`），运营改内容只能靠 AdminJS
直接改库。因此"管理内容"必须先在被拥有模块补写服务。

## 目标

1. 把 Lucent 改造为 monorepo（`apps/api` + `apps/admin`）。
2. 建立**有角色、有权限、有审计**的管理 API。
3. 补齐内容管理写路径（法务文档、用药安全提示），走所属模块导出 service（ADR-0009）。
4. 建设运营 dashboard：产品指标、漏斗、队列、用户查询、审计日志查询。
5. 前端 SPA 落在 `apps/admin/`，由 Fastify 同源挂载 `/admin`，**取代 AdminJS**。

## 非目标

- **不做通用表 CRUD**。管理端点只做聚合查询与精心编排的操作。
- **不做权限矩阵 UI**。角色是封闭小集合，权限矩阵以代码常量定义，不进 DB。
- **不做第二套认证**。复用现有 `User` + JWT（见决策 1）。
- **不引入 `packages/` 共享包**。`apps/api` 与 `apps/admin` 依赖零重叠；`packages/`
  留空目录占位。

---

## 关键决策

### 决策 1：认证模型 A —— `AdminUser` 挂现有 `User`

管理员是一条 `User` 行 + 一条 `AdminUser` 记录（携带 role）。密码、PIN、session、
JWT、限流、审计全部复用现有认证栈。

**理由**：`AdminGuard` 当前已在消费用户 JWT 的 email 做管理员断言，方向早已确定。
独立 `AdminAccount` 表意味着整套第二套认证代码，是纯负债。

**已接受的代价**：staff 账号会出现在用户列表与产品指标里。缓解——不在 `User` 上加标志位，
改为在 `AdminUser` 存在性上排除（查询侧 `adminUsers: { none: {} }`），避免在用户域引入
"这是不是员工"的语义泄漏。

### 决策 2：monorepo 化，切法 A（**归属已裁决**）

```
Lucent/
├── apps/
│   ├── api/          # 原仓库主体（见 U1 待裁决 scripts/ 归属）
│   └── admin/        # React SPA
├── packages/         # 暂空
├── pnpm-workspace.yaml   # 已存在，改为多成员
├── compose.yaml      # 留在根（编排多服务）
└── docs/  plans/  deployment/  monitoring/
```

**归属裁决（2026-09-30）**：`plans/2026-08-14-saas-modules-and-node-monorepo.md`
（主张 `apps/api + apps/saas + apps/website + apps/docs`）**已废置删除**。
本计划为 Lucent monorepo 形态的唯一事实源。

**切法 A 而非 B**：B（只搬 `src/`）让 `prisma.config.ts` 跨目录 `../src` 引用、
Dockerfile COPY 路径割裂，长期别扭。

### 决策 3：前端形态 —— clone shadcn-admin 当壳 + 装 Refine（**已修正**）

- **Refine**（`@refinedev/core`）提供数据/认证/权限/i18n 层。
- **refine-ui**（官方 shadcn 集成，经 shadcn registry 分发）提供**部分**组件
  （`views`/`buttons`/`forms` 等），**不接管表格**。
- **shadcn-admin** 提供 shell、sidebar、command palette，以及**表格栈**。

**router 方案（修正）**：`@refinedev/tanstack-router` **不存在**（npm 404，PR #6919
已关闭未合并）。Refine 官方支持的 router 集成仅有 `@refinedev/react-router` /
`nextjs-router` / `remix-router`。

两条可行路径：

- **路径 1（推荐）**：保留 shadcn-admin 的 TanStack Router，**手写 `routerProvider`**。
  接口面小（`go`/`back`/`parse`/`Link` 等约 4 个成员），预估一两天工作量。
  保住了 `src/routes/`、`routeTree.gen.ts`、`(auth)`/`(errors)`/`_authenticated`
  等 pathless layout route——这是 shadcn-admin 最结构化的资产。
- **路径 2（劣解）**：退回 `@refinedev/react-router`（v2.0.4），代价是拆掉上述整套
  文件式路由与 `routeTree.gen.ts` 重写。

**已核实的 shadcn-admin 事实**（v2.2.1）：

- `src/components/ui/` 有 30 个组件；`src/components/data-table/` 有
  `bulk-actions`/`column-header`/`faceted-filter`/`pagination`/`toolbar`/`view-options`
- `src/routes/` 顶层为 `(auth)`/`(errors)`/`__root.tsx`/`_authenticated`/`clerk`
- **TanStack Start 重写未发生**（树内 `tanstack/start` 匹配数为 0）
- 假数据 feature 仍在（`features/users|tasks/data/` 用 `@faker-js/faker`）
- `src/routes/clerk/` 与 `src/stores/auth-store.ts`（硬编码 `'thisisjustarandomstring'`）
  确实存在

**已接受的代价**：

1. shadcn-admin 不是 npm 包，只能 clone/fork，**背上需手动跟随上游的 fork**
2. 拆除假数据/Clerk/auth-store 后，**约 70–75% 的 shell 价值仍可保留**
3. 上游升级维护成本不因选型消失

### 决策 4：表格栈 —— 用 shadcn-admin 的（**已裁决**）

`@refinedev/react-table` + refine-ui 的 `DataTable/DataTableFilter*/DataTablePagination`
与 shadcn-admin 的 `src/components/data-table/` **都是 TanStack Table v8 + shadcn 原语**，
功能高度重叠。两套并存 = 两套分页模型、两套筛选状态、两套 URL 同步抢同一个 query string。

**裁决：用 shadcn-admin 的 data-table。** 保住 v2.2.1 的批量操作、列固定、URL 同步，
且与既有 shell 同源。**只从 refine-ui 取 `views`/`buttons`/`forms`，不取 `data-table`。**

### 决策 5：并行执行边界

- **`git mv` 必须单 owner 串行完成**（全仓原子操作，任何并行写入都会冲突）
- **并行只发生在 `git mv` 之后**：各配置族互不重叠，可按写入域切分
- **验证必须由 Lead 在冻结基线上单点执行**。并行完成不等于集成正确

---

## Phase R —— monorepo 搬迁

> **前置**：U1、U2 裁决完毕（已完成），U1 的 `scripts/` 拆分清单须在 R1 前定稿为
> 具体文件清单。
>
> **核心原则：本阶段结束后 AdminJS 仍然可用、全门禁全绿。** 用"没有破坏任何现有功能"
> 来证明搬迁正确，而不是靠肉眼比对 diff。功能改造一律不做。

### R-pre — 可行性探查【已执行，2026-09-30】

在隔离目录模拟 workspace 化，**未触碰仓库**。三项结论（详见文首「R-pre 探查结论」）：

- ✅ `overrides` 仍生效（fastify 单一版本）
- ⚠️ `pnpm prune --prod` 语义变化（剪枝位置与残留实体）
- ⚠️⚠️ **node_modules 布局变化会让 Dockerfile 的 COPY 与 7 条瘦身逻辑失效**

**R-pre 的追加任务（在 R3-G 前必须完成）**：单独验证 **`pnpm deploy --prod`**
能否从 workspace 生成自包含的 prod-only 目录，作为 Docker 镜像的新构建策略。
**验证结论未出之前，R3-G 不得定稿。**

### R0 — 前置冻结（单 owner，串行，Lead）

1. 确认工作区干净。
2. 记录基线：`lint:check`、`typecheck`、`typecheck:tools`、`build`、`test:ci`、
   `test:e2e:ci`、`arch:check`、`docs:verify`、`docs:links` 全部结果留痕。
3. 记录基线：`docker build` 成功 + 镜像内 `/admin` 可访问（AdminJS 此刻仍注册）。

### R1 — 目录搬迁（单 owner，串行，Lead）

**前置**：U1 的 `scripts/` 分层拆分清单已定稿为具体文件清单（见 U1 裁决表）。

已确定的搬迁对象：`src/`、`prisma/`、`test/`、`package.json`、
`tsconfig*.json`、`.swcrc`、`nest-cli.json`、`Dockerfile`、`entrypoint.sh`、
`.dockerignore`、`prisma.config.ts`、`vitest*.config.ts`、
`eslint.config.ts`、`eslint.arch.config.ts`、`.oxlintrc.json`、`eslint-plugins/`、
`compodoc.json`、`openapitools.json`、`commitlint.config.ts`、`.dependency-cruiser.cjs`，
以及 **`scripts/{arch,contract,import}`**（U1 分层裁决）。

留在仓库根的确定项：`compose*.yaml`、`docs/`、`plans/`、`deploy/`、`monitoring/`、
`pnpm-workspace.yaml`、`AGENTS.md`、`CLAUDE.md`、`.gitignore`、`.env*` 模板、`.github/`。

**待 U1 裁决**：`scripts/`。

**`pnpm-lock.yaml` 位置**：workspace 化后 lockfile 属于仓库根，**不在** `apps/api/`。
R1 不移动 lockfile，由 R2 在根重建。

### R2 — 工作区接线（单 owner，Lead，紧接 R1）

1. 根新建 `package.json`（private，`name: lucent-monorepo`，引擎与 packageManager
   与 `apps/api` 对齐），`scripts` 只做转发。
2. **修改现有** `pnpm-workspace.yaml`，加 `packages: ['apps/*', 'packages/*']`。
   保留现有 `allowBuilds`、`minimumReleaseAgeExclude`、`overrides`。
   `overrides.fastify` 的钉版理由（双副本导致 `FastifyInstance` 名义类型不兼容）
   在 workspace 下**依然成立且更关键**，不得删。
3. 根执行 `pnpm install` 生成根 lockfile，`pnpm why fastify` 断言单一版本。
4. `.gitignore` 路径按新布局修正。

### R3 — 配置与脚本修复（**可并行**，清单待 U1 裁决后定稿）

已核实的影响面（**初稿的"6 处"错误，以下为实测**）：

**A. tsconfig / 编译配置**：`tsconfig.json`、`tsconfig.build.json`、
`tsconfig.typecheck.json`、`.swcrc`（`baseUrl` + `paths["#generated/*"]`）、
`nest-cli.json`（`sourceRoot` + assets）

**B. Lint / 架构门禁**：`eslint.config.ts`（**19 行硬编码 `src/...` 路径**，
第 140-158 行的 error-handling 渐进清理 override 块 + 第 118 行 `src/admin/setup.ts`）、
`eslint.arch.config.ts`（6 处 glob）、`.oxlintrc.json`（overrides + ignorePatterns）、
`.dependency-cruiser.cjs`（**全部规则正则为 `^src/modules/...`**——若脚本以 `apps/api`
为 cwd 运行则可保持不变，**需实测确认**）

**C. `apps/api/package.json` 的 scripts 段**：`arch:check`、`format`、`format:check`、
`lint:eslint`（`"{src,apps,libs,test}/**/*.ts"`）

**D. `scripts/`（清单待 U1 裁决）**：已核实 **14 个文件持有仓库根常量**
（初稿只列了 6 个，且其中 2 个路径不存在）。

原初稿的错误条目：

- ~~`scripts/dev/env.ts:4`~~ → 实际 `scripts/shared/env.ts:4`
- ~~`scripts/dev/better-auth.config.ts:10`~~ → 实际 `scripts/spike/better-auth.config.ts:10`

实测持有 `REPO_ROOT`/`repoRoot` 的文件（hits 数）：

```
scripts/arch/check-ast-conventions.ts        (7)
scripts/contract/export-openapi.ts           (18)
scripts/dev/esm-import-extension-codemod.ts  (3)
scripts/dev/start-test-runtime.ts            (5)
scripts/dev/stop-test-runtime.ts             (2)
scripts/dev/up-local-stack.ts                (3)
scripts/docs/coverage.ts                     (4)
scripts/docs/links.ts                        (21)
scripts/docs/verify.ts                       (20)
scripts/import/medicine/import-medical-qa.ts (2)
scripts/import/medicine/import-medicine-datasets.ts (3)
scripts/import/medicine/import-medicine-knowledge.ts (2)
scripts/shared/db-upsert.ts                  (2)
scripts/shared/env.ts                        (3)
```

**这些不是"改路径"，是语义重新划分**（见 U1 四义性表）。且 `scripts/shared/env.ts`
导出 `REPO_ROOT` 被 `db-upsert.ts`、`import-medicine-knowledge.ts` **跨文件消费**，
是共享常量而非局部变量。

**E. 测试**：`test/e2e-helpers.ts`、`test/unit-helpers.ts`（8 处相对 import）、
`vitest*.config.ts`

**F. Prisma / 运行时**：`prisma.config.ts`（`schema: 'prisma/'`、
`migrations.path: 'prisma/migrations'`、`import './src/config/env/env-file-paths'`）

**G. Docker / 部署（最高风险 —— 经 R-pre 探查后上调）**：

R-pre 已证明 workspace 下 node_modules 布局与裁剪语义均变化。**本项不再是"改 5 条
COPY 路径"的量级**：

- `Dockerfile` 第 78 行的 `COPY /app/node_modules ./node_modules` 在 workspace 下
  **只拷 `.pnpm` 实体，不含 `apps/api/node_modules` 的符号链接** → 运行时模块解析失败
  （**构建会"成功"，故障只在容器里暴露**）
- deps/builder 阶段需新增 `apps/*/package.json` 的 COPY（`--frozen-lockfile` 需见全部成员 manifest）
- 7 条镜像瘦身逻辑的路径前缀全部重算（`.pnpm` 布局变化）
- 镜像体积**可能不减反增**
- **候选正解**：`pnpm deploy --prod` 生成自包含 prod-only 目录 —— **须先验证**
  （见 R-pre 追加任务），验证未过不得定稿
- `entrypoint.sh`（`node dist/main.js`）、`.dockerignore`、`compose.yaml`（build context）

### R4 — 基线验证（单 owner，串行，Lead）

R0 全部门禁重跑并逐项对比，外加：

- [ ] `docker build` 成功
- [ ] 镜像内 `GET /admin` 返回 AdminJS 面板（**证明搬迁未破坏现有功能**）
- [ ] 镜像内 `GET /api/v1/health` 深探针通过
- [ ] 镜像内 `/api/docs`（Scalar）正常
- [ ] 镜像体积与 R0 对比，记录差异

**任何一项失败 → 不进入 Phase 0。**

---

## Phase 0 —— ADR + 决策固化

- 新增 `docs/reference/adr/0023-admin-surface-and-rbac.md`：固化决策 1–5、非目标、
  AdminJS 的 break-glass 定位、以及 Phase R 的形态变更理由。
- ADR 须记录本计划修订记录中的 5 条初稿错误（避免后人重蹈）。

## Phase 1 —— RBAC 骨架

新增 `apps/api/src/modules/admin/`：

- `prisma/models/admin.prisma`：`AdminUser`（`userId` 唯一外键 → `User`、`role`、
  时间戳），`AdminRole = SUPER_ADMIN | ADMIN | EDITOR | VIEWER`
- migration（`add_admin_rbac`）
- `constants/permissions.ts`：权限矩阵常量（role → permission 集合）
- `decorators/require-permission.decorator.ts`：`@RequirePermission('content:write')`
- `guards/admin-permission.guard.ts`：未认证 → 401；无 `AdminUser` → 403（`FORBIDDEN`）；
  有 `AdminUser` 但无权限 → 403（`INSUFFICIENT_PERMISSION`，**错误码区分二者**）
- **播种不做自动**。改为主命令行脚本 `scripts/admin/seed-admin.ts`，显式执行。
- **提升 `AdminGuard`**：从 `product-events/guards/admin.guard.ts` 提升到 admin 模块，
  与 `AdminPermissionGuard` 共用身份解析；funnel 端点改用它。同一身份源不留两份。

**验收**：全门禁绿；单测覆盖四角色判定与三种拒绝路径；e2e 覆盖未认证 401 / 无 role 403。

## Phase 2 —— Admin API + 内容写路径

### 2a. 内容写服务（前置）

- `legal-documents`：新增写服务方法 + barrel 导出；写操作落 `AuditLogService`
- `medicines`：`MedicineSafetyTip` 写服务（`safety-tips` 在 `docs/TODO.md` D1 标记为
  dead-code 只读，写路径需新建）

### 2b. Admin 端点（全部走 `@RequirePermission`）

| 端点                                                      | 权限                                          |
| --------------------------------------------------------- | --------------------------------------------- |
| `GET /admin/metrics/overview`                             | `metrics:read`                                |
| `GET /admin/metrics/timeseries`                           | `metrics:read`                                |
| `GET /admin/users` / `GET /admin/users/:id`               | `users:read`                                  |
| `GET /admin/audit-logs`                                   | `audit:read`（**补齐读出口**）                |
| `GET /admin/funnel`                                       | `metrics:read`（复用 `ProductFunnelService`） |
| `GET /admin/content/legal-documents` / `PUT .../:docType` | `content:read` / `content:write`              |
| `GET /admin/content/safety-tips` / `POST/PUT/DELETE`      | `content:read` / `content:write`              |
| `GET /admin/ops/queues` / `GET /admin/ops/data-export`    | `ops:read`                                    |

- 响应走 zod + `@SerializeOptions({ schema })` + `registerResponseSchema`
- 错误走 RFC 9457 Problem Details（ADR-0012）
- 所有写操作调 `AuditLogService.log()`，记录 actor、资源、变更前后摘要

**验收**：`pnpm export:openapi` 后 spec 含全部端点；e2e 补「跨权限 → 403」与 list
limit 上限用例；内容写路径 e2e 断言 `audit_logs` 有记录。

## Phase 3 —— 前端 SPA（`apps/admin/`）

### 3a. 脚手架

- `git clone https://github.com/satnaing/shadcn-admin.git apps/admin`（v2.2.1），
  去 `.git`，纳入 Lucent 版本控制
- **前置（U3）**：逐个原语比对 shadcn-admin 版与 shadcn 官方 registry 版，
  区分「真定制」与「版本落后」，名单写入 `apps/admin/README.md`
- 装 `@refinedev/core`；**按决策 3 路径 1 手写 `routerProvider`**
- 引入 refine-ui 的 `views`/`buttons`/`forms`
  （`npx shadcn@latest add https://ui.refine.dev/r/views.json`——**注意 `.json` 后缀**），
  安装后按 U3 名单恢复真定制
- **不引入** refine-ui 的 `data-table`（决策 4）

### 3b. 拆除

- 删 `src/features/{users,tasks,apps,chats}/data/*.ts` 假数据
- 删 `src/routes/clerk/` 与 `src/stores/auth-store.ts`
- **保留** `src/components/data-table/`（决策 4）与 `src/components/layout/`

### 3c. 接线

- Refine `authProvider` → Lucent `/api/v1/auth/*`
- Refine `accessControlProvider` → 从 `/admin/me` 拉角色与权限集合
  （**前端可见性不是安全边界**，后端 `@RequirePermission` 才是）
- data provider **不写通用 REST 适配器**，按资源显式对接 admin 端点
- 类型从 `docs/reference/generated/openapi.json` 生成

### 3d. 挂载

- `@fastify/static` 挂 `/admin`，SPA fallback 到 `index.html`
- 替换 `main.ts` 中的 `registerAdminPanel` 调用
- helmet CSP 复核：`setup-app.ts` 的 `'unsafe-inline'` 同时服务 AdminJS 与 Scalar

## Phase 4 —— AdminJS 退役

- 移除 `adminjs`、`@adminjs/fastify`、`@sergiyiva/adminjs-prisma` 依赖，
  删除 `apps/api/src/admin/`
- 复核 `setup-app.ts` 中因 AdminJS 存在的 `bodyParser: false` 与 `@fastify/formbody`
  处理能否简化——**本次唯一可能顺带简化的历史包袱**
- `ADMIN_ENABLED` / `ADMIN_PASSWORD` / `ADMIN_COOKIE_SECRET` 退役后逐项裁决消费者
- 更新 `README.md`、`docs/reference/environment-variables.md` 全部 AdminJS 叙述

---

## 风险与缓解

| 风险                                                                       | 缓解                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **workspace 下 node_modules 布局变化破坏 Docker**（**R-pre 已证实**）      | R-pre 追加验证 `pnpm deploy --prod`；R3-G 不得在验证前定稿；R4 容器内实测模块解析 |
| **`pnpm prune --prod` 剪枝范围变化，镜像体积可能不减反增**（R-pre 已证实） | R4 记录镜像体积与 R0 对比；必要时改 `pnpm deploy` 策略                            |
| **`overrides.fastify` 在 workspace 下失效**（**R-pre 已排除**）            | R2 仍显式 `pnpm why fastify` 断言，防回归                                         |
| **Phase R 的 scripts 语义未定稿即开工**                                    | U1 已裁决分层；R1 前须定稿具体文件清单                                            |
| **搬迁破坏生产部署路径**                                                   | R0 记录 Docker 基线；R3-G 后立即 `docker build` + 容器内验证                      |
| **refine-ui CLI 静默覆盖 shadcn-admin 定制**                               | U3 已裁决；3a 前置逐个原语比对，区分真定制与版本落后                              |
| **手写 routerProvider 低估工作量**                                         | 路径 1 先做 spike 验证接口面；不成立再走路径 2                                    |
| **并行 owner 各改各的、集成后不一致**                                      | R4 由 Lead 在冻结基线上单点全量验证                                               |
| 管理员端点成为新越权面                                                     | 每端点强制 `@RequirePermission`；e2e 覆盖跨权限 403                               |
| 单次 `git mv` 产生巨大 diff                                                | R1 单独成一个 commit                                                              |

## 完成后需更新的文档

- `README.md`（仓库形态 + Admin Panel 章节重写）
- `AGENTS.md` / `CLAUDE.md`（workspace 结构、命令路径、`apps/` 约定）
- `docs/reference/environment-variables.md`（`ADMIN_*` 语义变更）
- `apps/api/src/modules/admin/README.md`（新建）
- `apps/api/src/modules/legal-documents/README.md`、`medicines/README.md`（写路径）
- `docs/reference/adr/0023-admin-surface-and-rbac.md`（Phase 0 产出）
- `apps/admin/README.md`（新建：上游跟随方式、U3 覆盖记录、router 选型）
- 各 Phase 完成时追加 `docs/logs/migration-log/YYYY-MM-DD.md`
- 根 `README.md` 说明与 `Luminary`（Next.js 多产品站）的边界
