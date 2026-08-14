# Lucent Docs

Lucent NestJS 后端的文档库。**活跃文档最小化**——只有会被 AI 或人读取的文档才保留，
实现状态以代码为准，历史状态归档在 `03-archive/`。

## 导航

按 Diátaxis 四象限组织，每篇活跃文档必须能归入一个象限：

- **参考（reference）**：事实清单，给正在实现/排查功能的人
  - [[01-reference/environment]]、[[01-reference/environment-variables]]、
    [[01-reference/toolchain]]、[[01-reference/code-quality]]、[[01-reference/deployment]]、
    [[01-reference/data-retention]]（数据保留与账户删除语义）、
    [[01-reference/contracts/README]]（前后端 API 边界）、[[Glossary]]
- **操作指南（how-to）**：完成任务的最小可执行步骤
  - [[01-reference/how-to/README]]（新增模块 / 部署 / 备份恢复 / 药品导入 / 客户端同步）
- **解释（explanation）**：跨模块心智模型与设计权衡（「为什么」主要留在 ADR）
  - [[01-reference/architecture]]
- **决策（decision）**：架构决策记录，只增不改
  - [[01-reference/adr/README]]
- **变更记录**：`02-logs/migration-log/`（按日期排序）、[[02-logs/README]]
- **当前状态**：[[00-current/TODO]]（活跃延后项，完成后删除条目）、[[00-current/Active_Product_Loop]]（产品闭环运行时状态）

## 写文档先选象限

新增文档前先问：**谁会读它？多久更新一次？** 若回答是「没人读」或「不会更新」，归档而不是新增。
然后按下表判定象限：

| 象限             | 读者是谁                       | 典型内容                                   | 放哪里                                                   |
| ---------------- | ------------------------------ | ------------------------------------------ | -------------------------------------------------------- |
| 参考 reference   | 正在实现/排查功能的人          | 环境变量、工具链、部署模型、API 合同、术语 | `01-reference/`（含 `contracts/`、`Glossary.md`）        |
| 操作指南 how-to  | 正在做某个任务的人             | 最小可执行步骤，按时间顺序                 | `01-reference/how-to/`                                   |
| 解释 explanation | 需要跨模块心智模型的人         | 概念、权衡、为什么这么设计                 | `01-reference/architecture.md`（仅跨模块稳定模型才新建） |
| 决策 decision    | 想知道「为什么当时这么定」的人 | 上下文 + 决策 + 后果                       | `01-reference/adr/`（只增不改）                          |

反例：

- ❌ 把「如何部署」写进 `deployment.md`（参考）→ ✅ 快速步骤进 `how-to/deploy.md`，部署模型留在 `deployment.md`
- ❌ 把某个设计权衡写进 `architecture.md` 正文 → ✅ 写 ADR，`architecture.md` 只留一句指向 ADR 的链接
- ❌ 新文档不选象限直接丢进 `01-reference/` → ✅ 先按上表判定；归不进任何象限的说明「没人读」，归档

## 文档边界

- `01-reference/architecture.md`（解释）— 模块依赖、AI 管道、路由、DB 约定、可观测性
- `01-reference/environment.md`（参考）— 本地环境、Docker、脚本与运行时基线
- `01-reference/environment-variables.md`（参考）— 环境变量完整参考（唯一事实源）
- `01-reference/deployment.md`（参考）— 生产部署模型参考
- `01-reference/data-retention.md`（参考）— 数据保留、清理管道与账户删除级联
- `01-reference/toolchain.md`（参考）— 工具链、OpenAPI 导出、CI、hooks
- `01-reference/code-quality.md`（参考）— 代码质量与可维护性约定
- `01-reference/adr/`（决策）— 架构决策记录
- `01-reference/contracts/`（参考）— 前后端 API 边界（Luminous 引用）
- `01-reference/how-to/`（操作指南）— 每篇指南聚焦一个常见任务
- `00-current/TODO.md`（当前状态）— 活跃延后项（完成后删除条目）
- `00-current/Active_Product_Loop.md`（当前状态）— 产品闭环合同与验证边界
- `02-logs/README.md` — 变更日志索引与主题导航
- `openapi.json` — 生成产物（`pnpm export:openapi`，禁止手改）

## 文档生命周期

- 新增文档前先问：**谁会读它？多久更新一次？** 若回答是「没人读」或「不会更新」，归档而不是新增。
- 每篇活跃文档头部带 YAML front-matter：`status: active` / `owner: backend` /
  `quadrant: reference | how-to | explanation` / `updated: YYYY-MM-DD`。
- 活跃文档数量上限：**reference ≤ 12、how-to ≤ 10、explanation ≤ 8**、adr 不设限（只增不改）、
  **00-current ≤ 5**。超限时合并或归档，新文档必须替换旧文档。
- 活跃文档超过 90 天未更新（git 变更或 front-matter `updated` 均计入）：
  `pnpm docs:verify` 会报警，处理流程：**`--verify` 报警 → owner 审阅 → 更新 `updated`
  或 `git mv` 到 `03-archive/`**。
- 归档：`git mv` 到 `03-archive/`，头部加 `status: archived`，信息不丢、可追溯；归档文档不参与覆盖校验。
- 未被 `docs/doc-map.yaml` 引用的活跃文档：`--verify` 报警「无读者」，归档。
- 变更记录只写 `02-logs/migration-log/YYYY-MM-DD.md`（单日文件一个 H1，章节用 `##`）。

## 覆盖校验

`docs/doc-map.yaml` 是映射规则的唯一事实源（本文件不再维护手工映射表）。运行
`pnpm docs:check` 查看当前变更需要更新哪些文档；pre-commit hook 阻断「代码变更但零文档」的提交。

- `pnpm docs:verify` — 引用完整性、单 H1、front-matter 元数据与 stale 检测
- `pnpm docs:links` — 全库 wikilink 与相对链接完整性（断链时 exit(1)）
