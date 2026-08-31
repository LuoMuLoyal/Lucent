---
status: active
owner: backend
---

# health-events

## 模块意图

健康事件(症状/不适)与每日签到的写模型:事件创建/结束/分页查询与签到 upsert。
导出跨模块所有权 façade,让建议、报告、用药剂量等模块按 ADR-0009 安全地读
事件数据。

## 边界

- 管:健康事件与签到的全部读写、事件归属校验、对外只读 façade。
- 不管:产品埋点上报通道(product-events,但事件结果会作为产品事件写入);
  事件数据的派生分析(reports / today-suggestion 自行消费)。

## 依赖方向

- imports:`PrismaModule`、`ProductEventsModule`。
- 被引用:exports `HealthEventsOwnershipService`;barrel 消费方
  `daily-records`、`medicine-dose-logs`、`reports`、`today-suggestion`。

## 内部结构

- `services/events.service.ts` — 事件创建/结束/查询领域逻辑。
- `services/check-ins.service.ts` — 每日签到 upsert,联动产品事件与
  `health-event.changed` 领域事件。
- `services/ownership.service.ts` — 跨模块所有权校验 + 只读 façade(ADR-0009)。
- `repositories/prisma-event.repository.ts` — `HealthEventRepositoryPort` 的
  Prisma 实现(读取已按 userId + 未删除过滤)。

## 测试承接

`health-events.controller.spec.ts`、`repositories/prisma-event.repository.spec.ts`、
`services/events.service.spec.ts`、`services/check-ins.service.spec.ts`、
`services/ownership.service.spec.ts`
