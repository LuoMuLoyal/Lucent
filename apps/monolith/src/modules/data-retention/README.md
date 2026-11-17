---
status: active
owner: backend
---

# data-retention

## 模块意图

防止数据库无限膨胀的定时清理器:每日 3:00 AM UTC(经 BullMQ Repeatable Job)
批量删除过期会话、旧已读通知、过期反馈抑制、到期原始产品事件,以及超过保留
期的软删账号(级联硬删)。`@Global` 模块自运行,无对外 API。

## 边界

- 管:上述五类数据的到期批量删除(`deleteMany`),单类失败只记日志、不阻断
  其余类别继续清理。
- 不管:业务数据的常规软删(各业务模块自管);保留期之外的合规策略决策。

## 依赖方向

- imports:`PrismaModule`;不依赖业务模块(common 仅取时间工具)。
- 被引用:无——由 app.module 注册并自驱动,`DataRetentionService` 虽导出但
  当前无消费方。

## 内部结构

- `services/data-retention.service.ts` — `DataRetentionService`:清理任务实现,
  按类别顺序执行,错误降级为 error 日志。

## 测试承接

- `services/data-retention.service.spec.ts`
