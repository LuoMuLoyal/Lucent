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

- imports:`PrismaModule`。
- 被引用:exports `ProductEventsService`;barrel 消费方 `health-events`、
  `reports`、`today-suggestion`。

## 内部结构

- `services/events.service.ts` — `ProductEventsService`:批量写入(重复
  clientEventId 跳过)与服务端事件记录(`appVersion: 'server'`)。
- `services/funnel.service.ts` — `ProductFunnelService`:漏斗窗口统计,样本
  过小时抑制逐日明细以保护个体隐私。
- `guards/admin.guard.ts` — 管理端点守卫。

## 测试承接

`product-events.controller.spec.ts`、`guards/admin.guard.spec.ts`、
`services/events.service.spec.ts`、`services/funnel.service.spec.ts`
