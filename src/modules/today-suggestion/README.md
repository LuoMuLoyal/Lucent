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
- `domain/suggestion/` — 建议卡词汇（`suggestion.types.ts`、`suggestion-candidate.ts`）。
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
  `src/modules/product-events/services/events.service.spec.ts` 的 drift-guard 锁住
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
