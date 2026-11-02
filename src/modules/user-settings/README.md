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

## 内部结构（ADR-0024 四层）

```
domain/settings/
  setting-key.ts      USER_SETTING_KEYS / ASSISTANT_CONTEXT_SETTING_KEYS / 默认值 / SettingUpsert
  user-settings.ts    UserSettings 聚合：行 → 资源（缺失即默认），patch → 待 upsert 行
  settings.ts         SettingsRepository 端口（listRows / upsertMany / seedDefaults）
application/
  services/user-settings.ts   UserSettingsService（IUserSettingsPort 实现，门面）
  use_cases/update-settings.ts  写 → 失效缓存 → 发布事件 → 重新读取
  read_models/user-settings.ts  UserSettingsView 组装（带缓存旁路）
  ports/settings-cache.ts / settings-events.ts / user-settings.ts（跨模块读端口）
adapters/http/
  settings.controller.ts      HTTP 入口
  dto/response.ts             UserSettingsDataDto / AssistantContextSettingsDto
  dto/update.ts               PATCH 请求体（`.strict()`）
infrastructure/
  persistence/settings.ts     PrismaSettings（UserSetting，按 key upsert）
  cache/settings.ts           CacheSettings（`user-settings:{userId}`，10 分钟）
```

`domain/` 与 `application/` 无 barrel；跨模块只经模块根 `index.ts`。

## 字段与默认值（`domain/settings/setting-key.ts`）

| 字段                                                                          | 默认      | 说明                                                       |
| ----------------------------------------------------------------------------- | --------- | ---------------------------------------------------------- |
| `aiSummariesEnabled`                                                          | `true`    | AI 生成摘要/建议开关                                       |
| `dataSharingConsent`                                                          | `false`   | 匿名化研究数据共享同意                                     |
| `assistantEnabled`                                                            | `true`    | 助手功能总开关                                             |
| `assistantMemoryEnabled`                                                      | `false`   | 跨对话记忆复用（与总开关刻意独立）                         |
| `waterTargetCount`                                                            | `8`       | 每日饮水目标（杯数）                                       |
| `assistantContext.{healthProfile,dailyRecords,sleepRecords,currentMedicines}` | 全 `true` | 助手上下文细粒度授权                                       |
| `updatedAt`                                                                   | `null`    | 最近更新时间（= 最新一行的时间戳，无行则为 `null`）        |
| `passwordReauthenticationRequired`                                            | 恒 `true` | 敏感操作需密码再认证（响应字面量，不落库、`PATCH` 不可改） |

存储：`UserSetting` 模型，每用户每 key 一行（`@@unique([userId, key])`）。
key 字符串同时存在于 **`src/common/constants/user-setting-keys.ts`**（`common/llm`
要读 `aiSummariesEnabled`，不能反向依赖本模块）与领域层的纯字面量（`domain/` 不得
import `common/`）。两份由 `user-setting-keys.spec.ts` 钉住，漂移即测试失败。
注意 `assistantContext.{healthProfile,…}` 四个开关各自是一条**独立设置行**，
存储 key 带 `assistantContext.` 前缀，不是一行 JSON。
读取走 10 分钟缓存（`user-settings:{userId}`），写后失效并发 `SETTINGS_CHANGED` 事件
（`common/events/domain-events.ts`），由 reports / today-suggestion 的监听器消费。
缓存读失败按 miss 处理（不 500）；事件发布失败只记日志（设置已落库）。

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

- 引用：Prisma、cache-manager、EventEmitter2。
- 被引用：`assistant`（能力发现与策略门禁）、`reports`（dashboard 经
  `IUserSettingsPort` 读 `aiSummariesEnabled`）、`today-suggestion`（collectors
  经 `IUserSettingsPort` 读设置）。三者都只依赖端口，不依赖具体类。
- Barrel 导出：`UserSettingsService`、`IUserSettingsPort`、类型
  `UserSettingsDataDto` / `UserSettingsResponseDto` / `UpdateUserSettingsDto` /
  `AssistantContextSettingsDto`、`USER_SETTING_KEYS`、`USER_SETTINGS_DEFAULTS`、
  `listDefaultBooleanUserSettings`、`userSettingsCacheKey`。
  **`ASSISTANT_CONTEXT_SETTING_KEYS` / `ASSISTANT_CONTEXT_DEFAULTS` 不在 barrel 内**，
  跨模块要用这四个开关请走 `IUserSettingsPort.getSettings().assistantContext`。

## Tests

`user-setting-keys.spec.ts`（key 与 `common/` 对齐）、
`domain/settings/*.spec.ts`（聚合：默认值回落、类型守卫、patch → 行）、
`application/read_models/user-settings.spec.ts`（读模型 + use case 顺序、
409 映射、未知错误上抛）、`adapters/http/settings.controller.spec.ts`。
