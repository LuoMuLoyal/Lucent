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
- 不管:产品埋点上报通道(product-events,但签到成功后会经
  `ProductEventsService.emitServerEvent` 写一条 `health_event_outcome_confirmed`
  产品事件);事件数据的派生分析(reports / today-suggestion 自行消费)。

## 依赖方向

- imports:`PrismaModule`、`ProductEventsModule`。
- 被引用:exports `HealthEventsOwnershipService`;barrel 消费方
  `daily-records`(校验事件归属)、`medicine-dose-logs`、`reports`
  (event-review)、`today-suggestion`(collector)。

## 内部结构

- `services/events.service.ts` — 事件创建/结束/查询领域逻辑。
- `services/check-ins.service.ts` — 每日签到 upsert,联动产品事件与
  `health-event.changed` 领域事件。签到日期按**用户 profile 时区**折算日历日
  (`formatDateOnlyInTimezone`),缺省 `DEFAULT_USER_TIMEZONE`;只允许对
  `status = active` 的事件签到;产品事件的 `clientEventId` 由
  `server-checkin-{eventId}-{date}` 确定性生成,重试由唯一约束去重。
- `services/ownership.service.ts` — 跨模块所有权校验 + 只读 façade(ADR-0009)。
  写路径与业务 service 留在模块内,消费方只经这里读(仓储读已按 `userId` +
  `deletedAt: null` 过滤):`findActive` / `findMostRecentEnded` /
  `findManyByUser` / `findPageByUser` / `findCheckIns` / `findCheckInCoverage` /
  `findTodayCheckIn` / `findUserTimezone`,以及给写路径用的
  `ensureOwnedByUser` / `ensureActiveOwnedByUser`。
  **`ensure*` 仍是 `Promise` + `unwrapResult` 的兼容垫片**(会抛
  `DomainFailureException`,由全局 filter 转成 Problem Details),等 `reports`、
  `medicine-dose-logs`、`daily-records` 迁到直接消费 `Result` 后删除;新调用方
  请优先用已返回 `Promise` 的只读方法,不要把 `ensure*` 当作范例。
- `repositories/event.repository.ts` — `HealthEventRepositoryPort`(业务形态的
  分页 `HealthEventPageQuery`/`HealthEventPage`,cursor 由调用方解码)与
  `repositories/prisma-event.repository.ts` 实现。写方法返回
  `ResultAsync`(`P2002`→`RESOURCE_CONFLICT`,`P2025`→`RESOURCE_NOT_FOUND`,
  未知 DB 错误原样抛出),读方法返回 `Promise<T | null>`——"查不到"是合法值,
  由应用层决定何时算失败。

## 测试承接

`health-events.controller.spec.ts`、`repositories/prisma-event.repository.spec.ts`、
`services/events.service.spec.ts`、`services/check-ins.service.spec.ts`、
`services/ownership.service.spec.ts`
