---
status: active
owner: backend
---

# notifications

## 模块意图

站内通知与推送的统一出口:站内信的创建/分页/已读,以及经极光(JPush)按
用户 alias 的移动端推送。以 `INotificationSender` port 暴露发送能力,让 auth、
建议、提醒等模块不必感知推送渠道细节。

## 边界

- 管:站内通知 CRUD 与已读、推送投递(push 审计行区分"未配置"与"真失败")。
- 不管:通知偏好设置(notification-preferences 模块);何时发通知的业务决策
  (由调用方模块通过 port 触发)。

## 依赖方向

- imports:`PrismaModule`;JPush 配置经 ConfigService 工厂注入。
- 被引用:exports `NotificationsService`、`PushDeliveryService`、
  `INotificationSender`;消费方 `auth`、`medicine-reminders`、
  `notification-preferences`、`data-export`、`today-analysis`、
  `today-suggestion`。

## 内部结构

- `services/notifications.service.ts` — 站内信创建(含 scope 去重)与查询;
  同时实现 `INotificationSender`。
- `services/push-delivery.service.ts` — 推送投递编排,结果永不 reject。
- `services/jpush.provider.ts` — JPush REST 调用封装。
- `ports/notification-sender.port.ts` — 发送能力 port(跨模块契约)。

## 测试承接

`notifications.controller.spec.ts`、`services/notifications.service.spec.ts`、
`services/push-delivery.service.spec.ts`、`services/jpush.provider.spec.ts`
