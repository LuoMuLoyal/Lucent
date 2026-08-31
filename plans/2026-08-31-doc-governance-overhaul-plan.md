# Lucent 文档治理改进计划(v2)— 2026-08-31

> 生命周期:本文件位于 `plans/*.md`,计划执行完毕后按 AGENTS.md 规则整体删除。
> 范围:仅 Lucent。Luminous 侧已有同类设计(doc-governance-evolution v2),本计划与其
> 共享方法论,不共享代码。
> v2 修订说明:吸收 Luminous 文档治理 v2 的核心结论——**文档面从未做过存在性审计,
> 顺序上审计先于一切同步基建**;并按其记录的意图对 Lucent docs 从头设计(不迁就现有
> 编号目录形态)。v1 中已确认的部分(模块 README 同址、约束可执行化、迁移日志按日
> 保留)全部保留。

## 1. 背景与问题本质

- 现行 `docs/doc-map.yaml` + `scripts/hooks/check-docs-updated.ts` 是**过程门禁**:
  "改了 X 目录必须 touch Y 文档"。touch 合规 ≠ 内容正确,位置映射必然误报(重命名/
  小修也触发)与漏报(跨模块语义变更不落映射路径)。AI 辅助开发下,强制 touch 退化
  为仪式性合规。
- 更根本的问题:**文档面从未做过存在性审计**。同步做得再好,同步的可能是本不该手写
  维护的内容。规则数量是文档面大小的函数——治本不是让规则更聪明,是让规则失去大部分
  约束对象。
- 文档漂移的根源只有一个:文档是代码的副本,副本与源必然漂移。出路两条:消除副本
  (生成化 / 单一事实源);校验结果而非过程(可执行断言)。**不能被机器验证的断言,
  注定漂移。**
- 约束层设计的实证依据:近 40 份增量审查(review/07-06 → 08-20)高频问题聚类,
  见 §6 引言表(错误处理 ~15 天、越权 ~12 天、重复造轮子每报必有、魔法数字 ~10 天、
  缓存一致性 ~8 天、DTO 校验 ~8 天、分页上限 ~6 天、日期时间 ~6 天、barrel 纪律 ~5 天)。

**已确认决策**(2026-08-31,用户拍板):

1. AI 指令单一来源:`Lucent/AGENTS.md` 唯一权威,其余入口指针化;维护者主用
   AGENTS.md 约定的工具。
2. 模块文档权威文件用 `README.md`,与代码同址;迁移日志保留按日粒度。
3. 模块级文档一次性全量下沉,不做长双轨。
4. 采纳 Phase 0 四问审计 + docs 去编号重建(本 v2 的主变更)。
5. Luminous 工作区中删除未提交的 v2 计划文本不处理、不回滚。

## 2. 治理模型

### 2.1 六向处置(审计裁决词汇)

每篇现存文档在 Phase 0 审计后,去向必须是以下之一:

| 处置         | 含义                                | Lucent 落点                                                     |
| ------------ | ----------------------------------- | --------------------------------------------------------------- |
| 生成消除     | 内容是代码投影,由生成器产出         | openapi.json、compodoc、模块清单/契约摘要生成器                 |
| 结构固化     | 内容是模块意图,与代码同址就近维护   | 模块 `README.md`(AI 改码时按需读取)                             |
| 测试承接     | 断言可机器验证,文档归档而非复制测试 | 依赖规则/架构测试/e2e 约定(§6)                                  |
| 独立归宿     | 决策与变更各有唯一账本              | ADR(决策,只 supersede)、迁移日志(事实,append-only)、plans(规划) |
| 前移编码时刻 | 约束在写码时由 lint/IDE 反馈        | ESLint / dependency-cruiser / AST 检查                          |
| 降级快照     | 低频叙事,仅 updated 兜底,只减不增   | explanation/ 类文档                                             |

### 2.2 目标 docs 结构(去编号,Diátaxis;目录名即腐烂策略)

```text
Lucent/docs/
  README.md          # 唯一索引(每子目录一行说明 + 存活文档列表)
  explanation/       # 为什么:治理、架构原则、策略——低频稳定,无门禁,updated 兜底
  reference/         # 是什么:生成优先;手写解读与生成区块共存
    adr/             # 存量 ADR 平移(不可变,只 supersede)
    generated/       # 全生成区(文件头 auto-generated 标记,CI diff 校验兜底)
  howto/             # 怎么做:少而精,新增须过四问;正文路径校验兜底
  logs/
    migration-log/   # 保留按日(决策 2)
  archive/           # 原 03-archive 整体平移,只进不出
```

设计要点:去 `0X-` 编号前缀;`Glossary.md` → `reference/`;`compodoc/` 维持生成管线
不动(在 README 索引中指向);`contracts/` 由 Phase 0 三拆裁决——模块专属内容下沉模块
README,跨模块契约留 `reference/`,过程性/一次性分析归 `archive/`。

### 2.3 层表(v1 保留,映射到处置)

| 层     | 内容                       | 维护机制                       | 对应处置                |
| ------ | -------------------------- | ------------------------------ | ----------------------- |
| 意图层 | 模块职责/边界/不变量/陷阱  | 模块 README 同址               | 结构固化                |
| 约束层 | 架构规则/依赖禁区/代码模式 | lint + 架构测试,漂移即红灯     | 测试承接 + 前移编码时刻 |
| 事实层 | API/类图/模块清单          | openapi.json、compodoc、生成器 | 生成消除                |
| 决策层 | 为什么这样设计             | ADR                            | 独立归宿                |
| 过程层 | 改了什么/如何验证          | 迁移日志按日 append            | 独立归宿                |

## 3. 执行总则

- 顺序:Phase 0 → 1 → 2 → 3 → 4;**先审计,后基建;先改检查器,再改文档**
  (避免检查器先红)。
- 每 Phase 独立 commit(`type(scope): 中文摘要`),并按纪律追加当日
  `docs/logs/migration-log/` 条目(重建前暂写 `docs/02-logs/`)。
- 生成器取数源只允许机器真相(openapi.json、prisma schema、编译生成产物),
  禁止扫描手写文件——生成器自身不得成为新漂移源。
- 每批次收尾 grep 全仓旧路径引用清零(AGENTS.md、doc-map、检查器、文档互链、
  workspace 根 AGENTS.md)。
- 文档处置统一归档:Phase 0 裁决为“删”的文档一律迁入 `archive/`(只进不出),
  不做物理删除;空目录壳等非文档清理除外。

## 4. Phase 0 — 文档面存在性审计(最优先)

范围:`docs/` 全部非生成文档(含 adr、contracts、how-to、00-current、README、
Glossary)、`Lucent/AGENTS.md`/`CLAUDE.md`、根 `plans/`。`compodoc/`、`openapi.json`
不参与(已是生成物)。ADR 与迁移日志预置裁决:保留,不进逐篇裁决。

四问:谁读?读完做什么?断言能否被机器校验(由谁承接)?腐烂速度?

审计表模板(附于本计划末尾,随执行填充):

```markdown
| 文档 | 读者 | 读完做什么 | 断言承接 | 裁决(六向之一) |
| ---- | ---- | ---------- | -------- | -------------- |
```

预置方向(最终以审计表裁决为准):

- `00-current/Active_Product_Loop.md`、`Notification_Preferences.md`:疑似现状叙事/
  契约复述,默认方向为归档,有价值断言由测试/生成物/模块 README 承接;
- `00-current/TODO.md`:保留(硬生命周期,完成即删);
- `contracts/` 15 篇三拆:模块专属 → 下沉模块 README;跨模块 → `reference/`;
  过程性 → `archive/`;
- `how-to/` 6 篇 → `howto/`(逐篇过四问,少而精);
- reference 八篇(architecture、environment 系、event-catalog、toolchain、
  code-quality、data-retention)→ explanation/ 或 reference/,逐篇定;
- `architecture-upgrade-analysis.md` 等一次性分析已在 archive,不动。

硬目标:存活文档面篇数较审计前 **-50%**(ADR、迁移日志、生成物、archive/ 均不计入);
被归档/被下沉断言 100% 有承接(测试/生成物/模块 README);产出审计表与迁移清单。

- [ ] 0.1 逐篇四问审计,产出审计表
- [ ] 0.2 00-current 与 contracts 按预置方向逐篇裁决
- [ ] 0.3 先改检查器:`doc-coverage-lib.ts` 目录 scope/前缀豁免(03-logs、04-archive、
      00-current)、front-matter 校验,适配新结构后再动文档
- [ ] 0.4 AGENTS.md 文档规则段按审计结果同步缩减(规则失去约束对象)

## 5. Phase 1 — 指令单一来源(约半天)

- [ ] 1.1 `Lucent/AGENTS.md` 保持唯一规则源;新建/改写 `Lucent/CLAUDE.md` 为
      `@AGENTS.md` 一行引用 + ≤2 行 Claude 专属说明
- [ ] 1.2 排查 `.github/copilot-instructions.md`、`GEMINI.md` 等入口,含规则正文的
      一律指针化
- [ ] 1.3 验收:除 AGENTS.md 外仓库内无第二份规则正文副本;失效引用由 Phase 3
      正文路径校验器兜底清零

## 6. Phase 2 — docs 去编号重建 + 模块 README 一次性下沉(约 2 天)

- [ ] 2.1 docs 重建:按 §2.2 目标结构执行——先改检查器(0.3 已做)→ `git mv` 平移
      存活文档(保留历史)→ 移除空编号目录壳;`docs/README.md` 重写为唯一索引
- [ ] 2.2 contracts 三拆落地(模块专属下沉/跨模块留 reference/过程性归 archive)
- [ ] 2.3 模块 README 全量:`src/modules/` 全部模块 + `src/common/`;`assistant`、
      `auth`、`today-suggestion` 按新模板重写。模板五段(≤60 行):职责与边界 /
      对外契约(一句话 + 指向 openapi.json tag)/ 不变量 / 依赖禁区 / 陷阱与决策
      (链 ADR)。禁止端点全表与服务清单——那是 openapi.json 与 compodoc 的职责。
      `auth/README.md` 现状即反模式实例("Token 配置通过 ConfigKey 读取"与审查发现的
      issuer/audience 硬编码已矛盾)
- [ ] 2.4 模块 README 旁放一行式 `AGENTS.md`(`@README.md`),支持嵌套加载的工具
      自动获得;根 AGENTS.md 写明"进入模块前先读该模块 README"
- [ ] 2.5 generated region 机制:`<!-- gen:<name>:start/end -->` 约定,生成器只重写
      区块内内容,手写解读永不覆盖;首个生成器 = 模块 README 契约摘要段
      (数据源:`docs/openapi.json` 的 tag → endpoint 列表),随 `pnpm export:openapi`
      运行
- [ ] 2.6 联动清零:workspace 根 `AGENTS.md`(0X-logs 等;站点目录相关由另行计划
      统一处理,本计划不涉及)、`Lumos-docs/scripts/sync-docs.ts` 路径表、Luminous 侧
      引用 Lucent docs 路径处,grep 旧路径清零
- [ ] 2.7 验收:全仓无 `0X-`/旧路径引用;存活文档面 -50%;模块 README 断言
      (≤60 行、无端点全表)进检查器

## 7. Phase 3 — 可执行约束(约 2–3 天,增量可插拔)

新增 `pnpm arch:check`,与 lint/build/test 并列进入 pre-push。每条规则先 warn
观察一周再转 error。

**A. dependency-cruiser(依赖图)**

- `src/modules/*` 之间禁止深路径 import,只准引用对方 `index.ts` barrel;
- 模块 `repositories/`、`dto/` 不得被其他模块直接 import(呼应 ADR 0009);
- `src/common/*` 禁止 import `src/modules/*`;
- 业务模块禁止直接 import Redis/缓存底层客户端,必须走公共封装;
- controller 禁止直接 import `@prisma/client` / PrismaService。

**B. ESLint(代码模式)**

- 空 catch 块必须含说明注释(审查 #1 静默吞错);
- service 层裸 `throw new Error` 告警,引导走 ADR 0012 错误契约;
- `no-magic-numbers` 白名单模式,先 warn;
- 测试文件禁 `: any`。

**C. AST 检查脚本(`scripts/hooks/`,复用 doc-coverage-lib 基建)**

- DTO 每属性至少一个 `@Is*` 校验器;
- controller 端点 guard 显式化:`@Public()` 或全局 guard 二选一必现;
- **正文路径存在性校验**:文档正文引用的 `src/**`、`docs/**`、`plans/**` 路径必须
  存在(扩展 `check-links.ts`;零误报,直接消灭改名类漂移)。

**D. e2e/单测约定(写入根 AGENTS.md + 测试模板)**

- 每个资源端点必须有"跨用户访问 → 404"用例;
- 所有 list 端点必须有 limit 上限用例。

原则:文档内容若已被测试断言,文档归档而非复制测试(Phase 0 处置执行时落实)。

## 8. Phase 4 — doc-map 退役(约半天 + 两周观察)

- [ ] 4.1 `check-docs-updated.ts` 删除"变更路径 → 必须 touch 映射文档"的 pre-commit
      阻断;先降级为 `--report` 仅报告,**并行观察两周**确认 `--verify` 结构检查 +
      正文路径校验已覆盖其保护价值后移除
- [ ] 4.2 `doc-map.yaml` 退役:仅保留 `--verify` 结构检查(front-matter、90 天
      新鲜度、引用完整性、正文路径);删除 `--staged` 变更门禁
- [ ] 4.3 pre-push 汇总更新:`pnpm lint:check` + `pnpm build` + `pnpm test:ci` +
      `pnpm arch:check`;生成器 diff 校验接入(改动 token/路由/openapi 而不跑
      生成器 → CI 红)
- [ ] 4.4 验收:改动单个模块代码不再触发任何文档 touch 要求;90 天巡检与正文路径
      校验照常工作

## 9. 不做的事

- 不优化 doc-map 匹配逻辑(类别规则、commit scope 驱动等)——过程门禁改良,方向错误;
- 不为退役中的机制写自动化;
- 不把测试写进文档——已被测试断言的内容归档而非复制;
- 不引入第三方文档平台——生成器 + Markdown + git 闭环;
- 冻结新增手写"现状叙事"文档;
- plans 与迁移日志不互相复制:plan 只记规划与裁决,日志只记事实与验证;
- 不动 compodoc 生成管线与 openapi 导出纪律;不引入 ADR 第三本账(Lucent 已有 ADR
  作为决策层,与 plans/迁移日志各司其职);
- Luminous 不在本次范围(其文档治理已有独立设计)。

## 10. 验收总览

- Phase 0:审计表完成;存活文档面 -50%;被归档断言 100% 承接;AGENTS 规则段同步缩减;
- Phase 1:指令文件唯一性成立;
- Phase 2:docs 去编号重建完成、README 唯一索引、模块 README 全量、generated region
  运行、联动路径清零;
- Phase 3:`pnpm arch:check` 全绿(豁免均有注释理由);正文路径校验上线;
- Phase 4:变更门禁语义消失,`--verify` 结构检查保留,两周观察通过;
- 回滚:各 Phase 独立 commit 可单独 revert;新规则均以 warn 起步;归档操作均保留
  git 历史可回溯,复位只需从 archive/ 迁回。

## 11. 审计表(Phase 0 已填充 2026-08-31)

逐篇四问(谁读/读完做什么/断言承接/腐烂速度)审计已完成,完整四问明细随 Phase 2
归档至 `docs/archive/2026-08-31-doc-governance-audit.md`。存活文档面 12 篇
(README、explanation/architecture、reference/{glossary,data-retention,deployment,
environment-variables,assistant-safety}、howto/{add-new-module,deploy,
restore-database-backup,run-medicine-import,sync-openapi-client}),较 38 篇基线压缩
68%,达成 -50% 硬目标;plans/backlog.md(原 00-current/TODO.md)为规划台账不计存活面。

| 文档                                       | 裁决                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| docs/README.md                             | 保留并重写为唯一索引(吸收 contracts/how-to 导航)                           |
| docs/Glossary.md                           | git mv → docs/reference/glossary.md                                        |
| 00-current/Active_Product_Loop.md          | 归档(验证状态自证于 specs + openapi.json)                                  |
| 00-current/Notification_Preferences.md     | 下沉 src/modules/notification-preferences/README.md 后归档                 |
| 00-current/TODO.md                         | git mv → plans/backlog.md(规划台账,完成即删)                               |
| 01-reference/architecture.md               | 瘦身为 docs/explanation/architecture.md(删数字快照,留心智模型+ADR 链)      |
| 01-reference/code-quality.md               | 归档(承接:AGENTS.md 错误规则 + eslint-plugins)                             |
| 01-reference/data-retention.md             | 保留 → docs/reference/data-retention.md                                    |
| 01-reference/deployment.md                 | 保留 → docs/reference/deployment.md(删一次性验收段)                        |
| 01-reference/environment-variables.md      | 保留 → docs/reference/(吸收 environment.md 内容)                           |
| 01-reference/environment.md                | 并入 environment-variables.md 后归档                                       |
| 01-reference/event-catalog.md              | 归档(承接:domain-events.ts + listener specs;模式一段并入 architecture)     |
| 01-reference/toolchain.md                  | 归档(事实源=package.json/CI/workflows)                                     |
| contracts/README.md                        | 导航并入 docs/README.md 后归档                                             |
| contracts/app-info-contract.md             | 下沉 src/modules/app-info/README.md 后归档                                 |
| contracts/assistant-contract.md            | 模块部分→assistant/README;AI 分层规则→explanation/architecture;归档        |
| contracts/assistant-capabilities.md        | 下沉 assistant/README 后归档                                               |
| contracts/assistant-rollout.md             | 并入 assistant/README 后归档                                               |
| contracts/assistant-safety.md              | 保留 → docs/reference/assistant-safety.md(跨模块医疗红线)                  |
| contracts/data-export-contract.md          | 下沉 data-export/README(reports 小节→reports/README)后归档                 |
| contracts/data-sources.md                  | 下沉 medicines/README 后归档                                               |
| contracts/data-sources-cn-products.md      | 下沉 medicines/README(构建细节承接=DrugDataBase 脚本)后归档                |
| contracts/data-sources-drugbank.md         | 下沉 medicines/README 后归档                                               |
| contracts/data-sources-food-composition.md | 归档(12 行占位,无实质内容)                                                 |
| contracts/data-sources-medical-qa.md       | 下沉 assistant/README(边界分层)后归档                                      |
| contracts/environment-contract.md          | 下沉 environment/README 后归档                                             |
| contracts/mine-settings-contract.md        | 下沉 user-settings/README(extras→user-health-context/README)后归档         |
| contracts/reminder-contract.md             | 下沉 medicine-reminders/README(偏好→notification-preferences/README)后归档 |
| how-to/\*.md 5 篇 + README                 | 5 篇 git mv → docs/howto/;README 并入 docs/README.md 后归档                |
| 02-logs/README.md                          | 归档(写作规则承接=AGENTS.md;索引=目录即排序)                               |
| superpowers/ 3 篇                          | 归档(已实施,承接=problem-catalog.spec + ADR-0012 + 迁移日志)               |
| docs/openapi.json + docs/compodoc/         | 生成消除 → docs/reference/generated/(生成器产出,禁手改)                    |
| 根 CONTEXT.md                              | 归档(纯重复 ADR-0012 词汇)                                                 |
| 根 todo.md                                 | 内容并入 plans/backlog.md 后删除(断言已被代码证伪)                         |
| 根 ROADMAP.md                              | 归档(严重失实:Security PIN/Prometheus/队列数均过时)                        |
| 根 CHANGELOG.md                            | 归档(承接=migration-log;0.1.0 发布时脚本重建)                              |
| AGENTS.md L50 envelope 断言                | 已证伪,改为直返资源 + Problem Details(ADR-0012)                            |
