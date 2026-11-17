---
status: active
owner: backend
---

# product-events

## 模块意图

产品埋点与业务指标的事实源:客户端批量上报事件(按 clientEventId 去重)、
服务端业务代码记录关键动作,并为管理员提供漏斗(funnel)分析查询。

## 边界

- 管:事件接收与落库、服务端事件记录 API、漏斗统计(小样本抑制逐日明细)。
- 不管:事件到期清理(由 data-retention 按保留期执行);运行日志/指标
  (common 的 logger、metrics)。

## 依赖方向

- imports:`PrismaModule`;`AdminModule`(漏斗端点复用其 `AdminGuard`,经
  `admin` barrel 取,不另建守卫)。
- 被引用:exports `ProductEventsService`(消费方 `health-events`、`reports`
  (clinic-summary 的分享/摘要)、`today-suggestion`(反馈记录))与
  `ProductFunnelService`(消费方 `admin` 的 `/admin/metrics/funnel`,经
  `admin-metrics.module.ts` 单向 import 本模块,避免与本模块→`AdminModule`
  的依赖成环)。
  `SUGGESTION_RULE_CODE_ALLOWLIST` 由本仓唯一使用它的漂移守卫
  `services/events.service.spec.ts` 引用,与 today-suggestion 的已注册规则集比对。

## 内部结构

- `services/events.service.ts` — `ProductEventsService`:批量写入(重复
  clientEventId 跳过;`suggestionRuleCode` 只接受白名单值)与服务端事件记录
  (`appVersion: 'server'`)。
- `services/funnel.service.ts` — `ProductFunnelService`:漏斗窗口统计,样本
  过小时抑制逐日明细以保护个体隐私。
- `product-events.controller.ts` — 上报端点另挂更严的 `@Throttle`
  (60s/10 次):一次请求最多写 `MAX_PRODUCT_EVENTS_PER_REQUEST` 条,批量放大
  写入,全局限流不够。

## 测试承接

`product-events.controller.spec.ts`、`services/events.service.spec.ts`
(含规则码白名单与 today-suggestion 注册表的漂移守卫)、
`services/funnel.service.spec.ts`
