---
status: active
owner: backend
---

# today-suggestion

## 模块意图

主动建议引擎:从日报、用药、健康事件、用户档案收集信号,经规则引擎生成
候选,再抑制/仲裁/生命周期管理后物化为建议卡片,必要时升级为推送通知。
采用 write-time materialization——数据变更时异步重算,GET 只读物化结果。

## 限界上下文(ADR-0024)

本模块承载 **Daily Guidance** 上下文(上下文名 `today-suggestion`)。**四层骨架已落地**：

- 聚合根:`DailySuggestion`(每用户每日一份,生命周期只前进)、
  `SuggestionFeedback`、`RuleDefinition`(版本化,`ruleId` 唯一)。
  8 条规则已在 `domain/policies/`（纯函数），规则契约与目录在 `domain/rule/`。
- `Signal`/`SignalSnapshot` 是读模型,不是聚合——不反向写源上下文。
  信号词汇在 `domain/signal/`，其中 `diet-facet.ts` 是**消费侧投影**：
  上游 `daily-records` 的 11 个 facet kind 里本上下文只认 9 个，
  边界画在 collector（ACL），规则不 import 上游类型。
- 领域事件(计划):`daily_suggestion_delivered`、`suggestion_suppressed`
  等,经 outbox 发布;消费上游事件触发重算。

**跨层词汇守卫**：`scripts/arch/diet-facet-mirror.spec.ts` 锁住「本上下文消费的
facet kind 在上游仍存在」。它与规则侧的行为测试**缺一不可**——规则侧管「我们的分支
还在不在」，上游侧管「数据还来不来」；改名会让规则分支永远收不到数据且不报错，
而日志区分不了「上游新增」与「上游改名」。

## 边界

- 管:信号采集、规则引擎(`SuggestionRule`)、仲裁打分、反馈抑制、建议
  生命周期、AI 文案与解释、重算队列与推送升级。
- 不管:信号原始数据写模型(daily-records / medicine-dose-logs /
  health-events);通知渠道细节(notifications);分析型输出(today-analysis)。

## 依赖方向

- imports:`PrismaModule`、`NotificationsModule`、`NotificationPreferencesModule`、
  `LlmRuntimeModule`、`LlmCommonModule`(common)、`DailyRecordsModule`、
  `MedicineDoseLogsModule`、`UserSettingsModule`、`ProductEventsModule`、
  `HealthEventsModule`。
- 被引用:barrel 导出 `LifecycleService` 与 `LIFECYCLE_REFRESH_CRON`(当前无
  直接 barrel 消费方);today-analysis 经领域事件
  `TODAY_SUGGESTION_MATERIALIZATION_CHANGED` 消费其物化变更。
- **规则码与产品事件白名单是双源**:`product-events` 的
  `SUGGESTION_RULE_CODE_ALLOWLIST` 逐字镜像本模块 `buildSuggestionRules()` 注册的
  `ruleId`(`event_check_in_trend` 是唯一未列入的规则)。反馈落库后
  `services/feedback/recorder.service.ts` 用 `suggestion.ruleId` 发
  `suggestion_actioned` 服务端事件,该 code 不在白名单会被
  `ProductEventsService.recordBatch` 判 `VALIDATION_FAILED`——新规则投入前必须
  先补白名单。该镜像由 `product-events/services/events.service.spec.ts` 的
  drift-guard 锁住，它经本模块 **barrel** 读规则目录（不再深引规则类）。

## 内部结构

> **类型词汇已全部下沉 `domain/`**：`types/` 里只剩 `materialization.types.ts` 与
> `copy-generation.types.ts` 两个队列载荷类型；曾用于过渡的 re-export shim
> **已全部删除**，全模块直接 import `domain/` 下的真源。

- `adapters/acl/collectors/` — 信号采集（`record` / `health-event` /
  `sleep-trend-builder`）。**ACL 的职责是把上游发布语言翻译成本上下文的语言**：
  它们只经对方的 **reader port**（`DailyRecordReaderPort`、`IUserSettingsPort`）
  读数据，再投影成 `SuggestionSignal`，不碰 Prisma、不查他上下文的表。
  `sleep-trend-builder` 是 `record` 的解析辅助（同层、同目录）。
- `infrastructure/persistence/materialization.ts` — **物化状态表，不是聚合**。
  `user_suggestion_materializations` 记录「这一天算到第几版」（
  `sourceVersion` / `computedVersion` / `status`），管的是**并发控制**而不是业务规则，
  所以没有 `domain/` 聚合：**版本单调是技术记账，不是领域不变量**。
  三点实证：`markPending` 不检查当前状态（`ready → pending` 合法且是正常路径——
  新信号必然让已就绪的建议重新待算）；`ready`/`failed` 只能从 `pending` 到达；
  **`stale` 不是状态而是投影**（`ready` 且 `sourceVersion > computedVersion` 时算出），
  因为它随时可由两个字段推导，无需持久化。派生状态归查询侧。
  它与 `DailySuggestion`（`user_suggestion`，真正的建议卡）是**两个东西**。
- `services/collectors/` 仍留 3 个文件（`medication` / `profile` /
  `medication-time-resolver`），是**已知状态**，不是遗漏：
  `medication` 与 `profile` 目前**绕过 reader port 直接 `PrismaService` 查
  `userCurrentMedicine` / `userMedicineReminder` / `userAllergy` / `userCondition`
  / `userProfile`**（ADR-0024 §3 违规），补 port 前不能进 `adapters/acl/`；
  `medication-time-resolver` 是 `medication` 的私有辅助（纯时间换算，**没有上游**
  可翻译，进 acl 会与唯一消费者分离），跟着它留。
- `domain/policies/{medication,lifestyle,sleep,health}/` — **8 条规则**（纯函数）。
  每条规则只依赖 `domain/` 内的类型与阈值，**零框架依赖**（无 `@Injectable()`、
  无 `Logger`）。规则类由 `domain/rule/rule-catalog.ts` 的 `buildSuggestionRules()`
  构造，`today-suggestion.module.ts` 的 `onModuleInit` 注册进 `RuleRegistry`。
  规则报告的问题用 `RuleDiagnostic` 结构化返回，**由调用方（pipeline）决定怎么记日志**
  ——规则既不持有 logger，也不替调用方决定呈现。
- `domain/rule/` — 规则基础设施：`rule-definition.ts`（契约）、`rule-catalog.ts`
  （`new` 8 条规则的唯一构造点）、`thresholds.ts`（阈值就是产品行为）、
  `symptom-severity.ts`（严重度序 → 可比数值）。
- `domain/signal/` — 信号词汇（`signal.ts`、`observed-metric.ts`、`diet-facet.ts`）。
- `domain/suggestion/` — 建议卡词汇与规则：`suggestion.types.ts`（类型/触发/置信度
  枚举）、`suggestion-candidate.ts`（规则产出的候选），以及 `daily-suggestion.ts`：
  **建议卡生命周期规则**（4 个状态：`active` / `fading` / `expired` / `dismissed`）
  - 门槛计算（`fadingThreshold` 8h / `fadeExpiryThreshold` 12h）+ `lifecycleRank`。
    **时间一律由调用方传入**（`at: Date`），域内不读时钟——「active 了 9 小时该不该
    fading」因此能用固定时间戳精确断言，不靠 fake timer。
    **门槛从这里导出让 SQL 谓词派生**（`updateMany` 的 `WHERE` 调 `fadingThreshold(...)`）：
    一个定义、一次物化，而不是「TS 一份规则 + SQL 一份规则」两处漂移。
    `generated` **不在域内建模**：Prisma 枚举里有，但 `persistActive` 直接建 `active`，
    该状态无生产者。
- `domain/feedback/score-multiplier.ts` — 反馈驱动的分数调整（**产品行为，不是统计**）：
  样本量 < 5 不调整（两次忽略是轶事不是信号，否则用户一个坏日子就能重塑建议）、
  接受率提升 / 抑制率降低且**对称封顶** ×1.5 / ×0.5（一条规则不能被无限埋没或抬高）。
- `application/use_cases/record-feedback.ts` — 记录用户对卡片的决定（编排，无 Prisma）。
- `application/ports/feedback.ts` + `infrastructure/persistence/feedbacks.ts` —
  `recordDecision` **在同一事务里写 feedback 行与推进卡片状态**。这不是跨聚合写：
  用户点「不需要」的完整含义是「我拒绝这张卡 **且** 它该消失」，拆开会变成
  「反馈记了卡还在」或「卡没了没记录」，而用户已经点过、无法修正。
  **feedback 行是这张卡的归宿，与卡片的状态转换是同一件事的两种持久化形态。**
- `services/feedback/stats.service.ts` — 只查库，并把计数交给上面的纯函数。
- `services/feedback/recorder.service.ts` — 旧的 `FeedbackService`，保留读侧
  （`loadActiveFeedbacks` 供抑制层用）与两个百分比静态访问器；
  **写侧已迁到 `RecordFeedbackUseCase`**。
- `application/read_models/` — 查询侧投影：
  `active-suggestions.ts`（Today 卡片：**`ACTIVE_LIFECYCLE_STATE` 过滤在此**、
  tone/icon/反馈按钮/证据与动作本地化）、`suggestion-history.ts`（历史：按
  `ruleId + subtype` 去重，用 `lifecycleRank` 决定保留哪个状态）。
  两者只依赖 `SUGGESTION_QUERY_PORT`，**不出现任何 Prisma 类型**——
  读模型的形状由「卡片该长什么样」决定，不由表结构决定。
- `application/ports/suggestion-queries.ts` + `infrastructure/persistence/suggestion-queries.ts` —
  查询端口与 Prisma 实现。**`where` 条件留在这层**（Today = 仅 active；
  历史 = 日期区间 + locale + 可选状态/类型），`where` 的字面值来自端口导出，
  不散在读模型里。
- `services/lifecycle/manager.service.ts` — 生命周期编排。**读写已分离**：
  两条读路径委托给上面的读模型（缓存仍在 service，属编排），写路径用 B2 的域规则。
  仍未迁移的是 `persistActive` / `expireStaleSuggestions` / `refreshLifecycleStates`
  的 `updateMany`（见 `docs/TODO.md` 的分页批处理项）。
- `domain/baseline/` — 基线维度与记录。
- `application/services/` — 两个注册表（`rule-registry.ts`、`rule-version-registry.ts`）。
  它们是**查找表**（Map 状态），不是领域对象，故在 application 层。
- `services/suggestion.service.ts` — 编排入口(含 recompute)。
- `services/pipeline.service.ts` / `presentation.service.ts` — 管线编排与 DTO 呈现。
- `services/collectors/` — 4 个信号采集器(用药/日报/档案/健康事件)。日报采集器
  产出的饮食信号 `diet_facets` 只读餐食分析的 `facets` 与投影列(见
  [daily-records README](../daily-records/README.md))：**不从 title/note 文本猜语义**。
- 规则中的 `diet_imbalance`(lifestyle)消费 `diet_facets`：同一饮食维度在窗口内至少
  两天值得留意才给候选，`high` 侧看 fried/sugar/sodium/fat/portion/carb，
  `low` 侧看 vegetable/fruit/protein。
  **规则是纯对象，不是 Nest provider**：8 条规则由 `domain/rule/rule-catalog.ts`
  的 `buildSuggestionRules()` 构造，`today-suggestion.module.ts` 的 `onModuleInit`
  把它们注册进 `RuleRegistry`(重名直接抛错)。规则类**没有 `@Injectable()` 也
  没有构造依赖**——这是刻意的，且两道防线都**实测过**：
  1. **给规则加构造依赖 → 编译期失败**。规则只由 `rule-catalog.ts` 的
     `new XxxRuleService()` 构造，多一个必填参数即 `TS2554`（实测：catalog 与
     `product-events` 的 drift-guard spec 同时报错）。
  2. **绕过目录去注入规则 → 启动时失败**。规则不再是 provider，任何
     `private readonly rule: XxxRuleService` 都会让 Nest 在模块初始化时抛
     `Nest can't resolve dependencies of ...`（实测）。

  第 2 条是**启动时**、不是编译期——DI 注入本身是合法 TS，类型系统拦不住；
  要变成编译期得把规则改成对象字面量而非 class，当前没这么做（8 条规则带
  `BaselineDimension` 等实例字段，class 更贴合）。
  `randomUUID()` 留在规则内(候选 id 不落库、只活在一次请求里)，不注入 id 生成器
  ——注入会给纯函数加构造依赖，恰好破坏这条性质。
  规则码与 `product-events` 白名单的漂移由
  `src/modules/product-events/application/use_cases/events.spec.ts` 的 drift-guard 锁住
  （它经本模块 **barrel** 读 `buildSuggestionRules()`，不再深引规则类）；
  目录本身(8 条都在、无重名)由 `domain/rule/rule-catalog.spec.ts` 锁住。

- `services/arbitration/` — 打分(scoring)、抑制(suppression)、仲裁(arbiter)。
- `services/lifecycle/` — 生命周期管理(manager)与基线判定(baseline)。
- `services/action-label.ts` — 卡片动作/证据标签的本地化解析,`toDto`(重算内联路径)
  与 `getActiveSuggestions`(读路径)共用。**两条路径必须都过这里**:持久化的
  `primaryAction.label` 是规则的模板 key(`complete_profile`)而非展示文案,
  读路径漏本地化就会把内部标识符当按钮文案下发。
- `services/materialization/`、`services/recompute/` — 物化存储与重算三件套
  (queue/trigger/worker)。worker 在生成文案前读 `profile.locale` 决定语言
  (文案在重算时就被物化);用户未设语言时用 `constants/locale.constants.ts` 的产品默认。
- `services/cache/` — 信号/基线缓存与领域事件失效监听。
- `services/copy/`、`services/explanation/` — AI 文案与 AI 解释(各含队列)。
- `services/feedback/` — 反馈记录与统计(SUPPRESS 影响后续过滤)。
- `services/notification/escalation.service.ts` — 推送升级判定。

## 测试承接

`today-suggestion.controller.spec.ts`、`schemas/explanation.schema.spec.ts`、
`domain/**/*.spec.ts`（8 条规则 + `rule-catalog`）、
`application/services/*.spec.ts`（两个注册表）、
`services/**/*.spec.ts`(arbitration/collectors/lifecycle/recompute 逐文件覆盖)。

规则 spec **不需要 DI 容器**：10 个规则 spec 全部 `new XxxRuleService()` 直接构造。
规则没有构造参数，所以「去 `@Injectable()`」是消除框架依赖 + 阻止未来注入，
不是「让规则变得可测」——它们本来就可测。

跨层守卫在 `scripts/arch/`（`diet-facet-mirror.spec.ts`），走 `pnpm test:tools`：
`domain/` 不能 import 上游模块，`src` 内没有位置能同时看到两侧。
