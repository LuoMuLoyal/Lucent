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

- imports:`PrismaModule`;JPush 配置经 ConfigService 工厂注入
  (`JpushPushProvider` / `PushDeliveryService` 都由 `useFactory` 装配)。
- 被引用:exports `NotificationsService`、`PushDeliveryService`、
  `INotificationSender`;经 barrel 消费方 `auth`(安全通知、密码变更)、
  `medicine-reminders`(提醒派发)、`notification-preferences`(周报)、
  `data-export`(导出完成)、`today-analysis`、`today-suggestion`(升级通知)。
  `PushDeliveryService.sendToUser` 的全量 caller 恰为
  `medicine-reminders`、`notification-preferences`、`today-analysis`、
  `today-suggestion` 四处。

## 内部结构

- `services/notifications.service.ts` — 站内信创建(含 scope 去重)与查询;
  同时实现 `INotificationSender`。
- `services/push-delivery.service.ts` — 推送投递编排,结果永不 reject。
- `services/jpush.provider.ts` — JPush REST 调用封装。
- `ports/notification-sender.port.ts` — 发送能力 port(跨模块契约)。

## 不变量与陷阱

- `INotificationSender` 是**写侧最小面**,只含 `create` 与
  `createOrReplaceScoped`;要读/改已读态请显式注入 `NotificationsService`。
- 去重靠 `scope`:给 `scopeKey` 时走 `(userId, type, scopeKey)` 唯一键 upsert;
  不给 `scopeKey` 时按 `type` + `actionPayload` 匹配并删除历史重复行,窗口是最近
  50 条——**同一用户同一 type 的长期高频通知必须带 `scopeKey`**,否则会被当成重复。
- 通知文案在**写入时**定型(按用户 `UserProfile.locale` 渲染后落库),不是读取时
  翻译;要改文案语言只能改写入点。
- 未配置 JPush 凭据时 `sendToUser` 返回 `{ sent: false, errorMessage:
'push_not_configured' }` 且不发网络请求——调用方据此把审计行与「真失败」区分开,
  不要把这个值当异常处理。

## 测试承接

`notifications.controller.spec.ts`、`services/notifications.service.spec.ts`、
`services/push-delivery.service.spec.ts`、`services/jpush.provider.spec.ts`
