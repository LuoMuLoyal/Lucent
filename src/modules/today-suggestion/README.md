---
status: active
owner: backend
---

# today-suggestion

## 模块意图

主动建议引擎:从日报、用药、健康事件、用户档案收集信号,经规则引擎生成
候选,再抑制/仲裁/生命周期管理后物化为建议卡片,必要时升级为推送通知。
采用 write-time materialization——数据变更时异步重算,GET 只读物化结果。

## 限界上下文(ADR-0024 目标形态)

本模块承载 **Daily Guidance** 上下文(上下文名 `today-suggestion`)。按
ADR-0024 计划中的聚合边界(迁移到四层骨架时生效,当前仍是 rule 引擎形态):

- 聚合根:`DailySuggestion`(每用户每日一份,生命周期只前进)、
  `SuggestionFeedback`、`RuleDefinition`(版本化,`ruleId` 唯一)。
- `Signal`/`SignalSnapshot` 是读模型,不是聚合——不反向写源上下文。
- 领域事件(计划):`daily_suggestion_delivered`、`suggestion_suppressed`
  等,经 outbox 发布;消费上游事件触发重算。

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
  `SUGGESTION_RULE_CODE_ALLOWLIST` 逐字镜像本模块 `RegistryService` 注册的
  `ruleId`(`event_check_in_trend` 是唯一未列入的规则)。反馈落库后
  `services/feedback/recorder.service.ts` 用 `suggestion.ruleId` 发
  `suggestion_actioned` 服务端事件,该 code 不在白名单会被
  `ProductEventsService.recordBatch` 判 `VALIDATION_FAILED`——新规则投入前必须
  先补白名单。

## 内部结构

> **迁移进行中**：类型词汇正从 `types/` 下沉到 `domain/`（ADR-0024），
> 之后规则才能移入 `domain/policies/`（规则目前 import 的 `types/` 与
> `constants/` 都在 domain 树外）。`types/*.ts` 里可能残留**临时 re-export
> shim**——它们是转发层、真源在 `domain/`，迁移完成后删除，见文件头注释。

- `domain/suggestion/suggestion.types.ts` — 建议卡的领域词汇（类型/触发方式/
  生命周期/置信度），规则与策略据此判定。
- `services/suggestion.service.ts` — 编排入口(含 recompute)。
- `services/pipeline.service.ts` / `presentation.service.ts` — 管线编排与 DTO 呈现。
- `services/collectors/` — 4 个信号采集器(用药/日报/档案/健康事件)。日报采集器
  产出的饮食信号 `diet_facets` 只读餐食分析的 `facets` 与投影列(见
  [daily-records README](../daily-records/README.md))：**不从 title/note 文本猜语义**。
- `services/rules/` — 规则注册表与 8 条规则(medication/lifestyle/sleep/health)，
  其中 `diet_imbalance`(lifestyle)消费 `diet_facets`：同一饮食维度在窗口内至少
  两天值得留意才给候选，`high` 侧看 fried/sugar/sodium/fat/portion/carb，
  `low` 侧看 vegetable/fruit/protein。
  **规则是纯对象，不是 Nest provider**：8 条规则由 `services/rules/rule-catalog.ts`
  的 `buildSuggestionRules()` 构造，`today-suggestion.module.ts` 的 `onModuleInit`
  把它们注册进 `RegistryService`(重名直接抛错)。规则类**没有 `@Injectable()` 也
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
  `src/modules/product-events/services/events.service.spec.ts` 的 drift-guard 锁住；
  目录本身(8 条都在、无重名)由 `services/rules/rule-catalog.spec.ts` 锁住。

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
`services/**/*.spec.ts`(arbitration/rules/collectors/lifecycle/recompute 逐文件覆盖)

规则 spec **不需要 DI 容器**：10 个规则 spec 全部 `new XxxRuleService()` 直接构造。
规则没有构造参数，所以「去 `@Injectable()`」是消除框架依赖 + 阻止未来注入，
不是「让规则变得可测」——它们本来就可测。
