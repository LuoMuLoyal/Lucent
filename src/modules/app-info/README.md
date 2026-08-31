---
status: active
owner: backend
---

# app-info

面向客户端「关于/更新检查」的服务端运行时元数据，公开只读。

## Endpoints（事实源 = openapi.json）

- `GET /api/v1/public/app-info` — 无需鉴权（`@Public()`）。
  响应是 `AppInfoDto` 资源本身，不包 `{ code, message, data }` 信封；
  普通失败走 `application/problem+json`（稳定 code + 本地化 title/detail）。

## 字段语义

```text
minClientVersion: string | null  // 最低可用客户端版本提示
latestVersion:    string | null  // 最新可用客户端版本
downloadUrl:      string | null  // 更新/下载页 URL
supportEmail:     string | null  // 关于页支持联系邮箱
```

- 四个值在启动时从环境变量一次性读入（`SUPPORT_EMAIL`、
  `MIN_CLIENT_VERSION`、`LATEST_VERSION`、`DOWNLOAD_URL`，经 `EnvKey` 枚举
  走 ConfigService）；空值/空白归一化为 `null`。
- 无数据库、不读 `package.json`；版本号变更是部署期配置而非运行时写入。
- **不含**应用名/版本/构建号——客户端通过 `package_info_plus` 本地获取，
  后端刻意不镜像这些字段。

## 边界

- 本模块只承载 about/更新元数据；FAQ 内容留在客户端资产中，无实时
  CMS；不含付费/带凭据的外部服务。
- 归属判定见 mine-settings 契约的 ownership 表：App about metadata = Server。

## 内部结构

- `app-info.controller.ts` — `@Controller('public')` + `GET app-info`。
- `services/info.service.ts` — 构造时读取环境变量并缓存为不可变快照。
- `dto/response.dto.ts` — `AppInfoResponseDto`（四字段均可空）。

## Dependencies

- 引用：ConfigService（`config/env/env-keys.enum.ts`）。
- 被引用：`app.module` 注册；无其他模块消费其导出。

## Tests

`app-info.controller.spec.ts`、`services/info.service.spec.ts`。
