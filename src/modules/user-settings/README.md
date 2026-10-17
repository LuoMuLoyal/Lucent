---
status: active
owner: backend
---

# user-settings

用户级偏好设置（AI/隐私/助手开关与水量目标），服务端持有、跨设备同步。
设备本地状态（OS 通知权限、本地通知排程、主题、语言偏好）不归本模块。
health-context 的 profile extras 属 `user-health-context`。

## Endpoints（挂 `/user` 前缀，事实源 = openapi.json）

- `GET /api/v1/user/settings` — 返回 `UserSettingsDataDto` 资源。
- `PATCH /api/v1/user/settings` — 部分更新（逐 key upsert），返回更新后
  全量资源；并发 upsert 冲突映射 409 `RESOURCE_CONFLICT`。

## 字段与默认值（`settings.constants.ts`）

| 字段                                                                          | 默认      | 说明                                                       |
| ----------------------------------------------------------------------------- | --------- | ---------------------------------------------------------- |
| `aiSummariesEnabled`                                                          | `true`    | AI 生成摘要/建议开关                                       |
| `dataSharingConsent`                                                          | `false`   | 匿名化研究数据共享同意                                     |
| `assistantEnabled`                                                            | `true`    | 助手功能总开关                                             |
| `assistantMemoryEnabled`                                                      | `false`   | 跨对话记忆复用（与总开关刻意独立）                         |
| `waterTargetCount`                                                            | `8`       | 每日饮水目标（杯数）                                       |
| `assistantContext.{healthProfile,dailyRecords,sleepRecords,currentMedicines}` | 全 `true` | 助手上下文细粒度授权                                       |
| `updatedAt`                                                                   | `null`    | 最近更新时间                                               |
| `passwordReauthenticationRequired`                                            | 恒 `true` | 敏感操作需密码再认证（响应字面量，不落库、`PATCH` 不可改） |

存储：`UserSetting` 模型，每用户每 key 一行（`@@unique([userId, key])`）。
key 字符串的唯一来源在 **`src/common/constants/user-setting-keys.ts`**
（不是 `constants/settings.constants.ts`——后者只是把它们组装成
`USER_SETTING_KEYS` / `ASSISTANT_CONTEXT_SETTING_KEYS` 两个映射并附默认值，
因为 `common/llm` 也要读 `aiSummariesEnabled`，key 下沉到 common 才不反向依赖本模块）。
注意 `assistantContext.{healthProfile,…}` 四个开关各自是一条**独立设置行**，
存储 key 带 `assistantContext.` 前缀，不是一行 JSON。
读取走 10 分钟缓存（`user-settings:{userId}`），写后失效并发 `SETTINGS_CHANGED` 事件
（`common/events/domain-events.ts`），由 reports / today-suggestion 的监听器消费。

## Ownership 归属判定（契约表）

| 项                                  | 归属                                      |
| ----------------------------------- | ----------------------------------------- |
| AI/隐私开关、数据共享同意、助手开关 | **Server**（本模块持久化）                |
| 主题模式/配色                       | Device（SharedPreferences，不同步）       |
| 语言偏好                            | Device（另经 health-context locale 通路） |
| 通知权限（OS 授权）                 | Device                                    |
| 提醒排程                            | Device（本地通知控制器）                  |
| App 关于元数据                      | Server（见 app-info 模块）                |
| 数据导出请求                        | Server（见 data-export 模块）             |

客户端可经 assistant 的 settings proposal 改本模块字段，但落地仍走
`IUserSettingsPort.updateSettings`，权限校验不在这里。

## Dependencies

- 引用：Prisma、cache-manager、EventEmitter2、`common/constants/user-setting-keys`。
- 被引用：`assistant`（能力发现与策略门禁）、`reports`（dashboard 经
  `IUserSettingsPort` 读 `aiSummariesEnabled`）、`today-suggestion`（collectors
  经 `IUserSettingsPort` 读设置）。三者都只依赖 port，不依赖具体 service。
- Barrel 导出：`UserSettingsService`、`IUserSettingsPort`、
  `USER_SETTING_KEYS`、`USER_SETTINGS_DEFAULTS`、`listDefaultBooleanUserSettings`、
  `userSettingsCacheKey`、类型 `AssistantContextSettingsDto`。
  **`ASSISTANT_CONTEXT_SETTING_KEYS` / `ASSISTANT_CONTEXT_DEFAULTS` 不在 barrel 内**，
  跨模块要用这四个开关请走 `IUserSettingsPort.getSettings().assistantContext`。

## Tests

`user-settings.controller.spec.ts`、`services/user-settings.service.spec.ts`、
`constants/settings.constants.spec.ts`。
