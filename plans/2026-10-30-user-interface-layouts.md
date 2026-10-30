# 用户界面布局：后端权威的 surface 布局存储

> 状态：**草案，待评审**。2026-10-30 起草。
> 范围：`Lucent` 后端为主；消费方是 `Luminous`（Flutter 客户端）。
> 前置阅读：`Luminous/plans/2026-10-28-composable-tabs.md` §2.7、`src/modules/user-settings/README.md`、
> `docs/reference/adr/0012-error-contract-and-result-boundary.md`。

## 一、结论

客户端已把「每个 tab 挂哪些组件、什么顺序、多宽」做成用户可编辑的**表面布局**
（`SurfaceLayout`），但持久化目前只落在设备本地。要满足「多设备一致、换机不丢、
重装不丢」，必须有一个后端权威副本。

本文只解决这一件事：**新增资源 `layouts`，保存客户端自定义的布局文档**。

- 服务端**不解释**布局语义，只做三件事：按 `surface` 存取、`schemaVersion` 区间校验、
  `version` 单调递增 + 乐观并发控制。
- 语义解析、迁移、降级全部在客户端——这样布局格式演进时后端不需要跟着改。

## 二、契约

### 2.1 资源模型

```text
GET  /layouts
  → 200 { surfaces: { <surface>: LayoutDoc } }

GET  /layouts/:surface
  → 200 LayoutDoc
  → 404 该 surface 尚无布局

PUT  /layouts/:surface
  body: { ifVersion: int?, doc: LayoutDoc }
  → 200 LayoutDoc
  → 409 { current: LayoutDoc }        // 版本冲突
  → 422 不支持的 schemaVersion

LayoutDoc = { version: int, schemaVersion: int, payload: <客户端自定义 JSON> }
```

`surface` 取值：`today` / `record` / `medicine` / `review` / `mine` / `tab_chrome`。

**为什么把 `tab_chrome` 也放进同一个资源**：底部 tab 的图标/名称/顺序（客户端需求第 10 条）
与页面布局在数据形态上完全一致——都是「一个有序的配置文档」。共用资源省掉一整套端点，
只是 `payload` 结构不同。

**为什么用 `PUT` 而不是 `PATCH`**：布局文档是**整体替换**的语义。用户拖一次组件，
整份布局就变了；部分更新既表达不了顺序变化，也会让客户端与服务端的差异更难推理。

### 2.2 为什么是一张表而不是六张

所有 surface 共用一张 `layouts`，主键 `(user_id, surface)`。理由：

- 六个 surface 的**文档结构完全一样**（`version` / `schemaVersion` / `payload`）；
- 新增 surface 时不需要迁移表结构；
- 一次 `GET /layouts` 就是一次查询 + 一次 `IN` 过滤，不需要六次往返。

这与 `user_settings`（单行聚合整份设置）是同一手法：**结构一致的配置放一行 JSON 列**，
而不是为每个字段建列。

### 2.3 并发与冲突

| 场景                     | 处理                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| 首写（新账号）           | `ifVersion = null`，服务端建行，`version = 1`                          |
| 正常更新                 | `ifVersion = 当前 version`，服务端 `version + 1`                       |
| 两台设备同时改           | 后到者 `ifVersion` 不匹配 → `409` + 当前文档，客户端以服务端为准并提示 |
| 客户端不知道 `ifVersion` | 允许省略，视为「强制覆盖」——用于离线队列重放后的补偿写入               |

**冲突不自动合并**。布局是有序列表，自动合并两个不同的顺序没有正确答案；以服务端
为准 + 提示用户重排，比悄悄合并出一个谁都没想到的顺序更诚实。

### 2.4 `schemaVersion` 校验

服务端维护一个支持区间 `[MIN_SUPPORTED, MAX_SUPPORTED]`：

- 低于 `MIN`：`422`，提示客户端升级（老客户端写的新格式不能接受）。
- 高于 `MAX`：`422`，客户端整体回退默认布局（不猜、不截断）。

服务端**不解析 `payload`**，因此布局格式加字段、改组件 id 都不需要发后端版本。

## 三、数据库

### 3.1 新表

```prisma
// prisma/models/layouts.prisma

/// 一个用户某个 surface 的界面布局。
///
/// `payload` 是客户端自定义 JSON，服务端不解释；只校验 `schemaVersion` 区间与
/// `version` 单调。这份文档决定「这一页挂哪些组件、什么顺序、多宽」，
/// 语义完全由客户端掌握。
model Layout {
  id     String @id @default(uuid())
  userId String @map("user_id")
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// 表面标识：today / record / medicine / review / mine / tab_chrome。
  /// 不设外键——surface 是客户端概念，后端只存不认。
  /// 校验在请求 schema，不在数据库。
  surface String

  /// 乐观并发令牌，每次成功写入 +1。
  version Int @default(1)

  /// 布局文档的**形状**版本，与 `version` 正交：前者防格式不兼容，后者防并发覆盖。
  schemaVersion Int @map("schema_version")

  /// 客户端自定义布局文档。服务端只做 JSON 合法性保证。
  payload Json @db.JsonB

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@unique([userId, surface])
  @@map("layouts")
}
```

### 3.2 表名与命名依据

表名 **`layouts`**，与端点 `/layouts` 一致——**表就是资源**。

| 约定            | 依据                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 与资源路径同名  | 端点是 `/layouts`，表就是 `layouts`；两者用同一套判断标准，不引入第二套                                                                                                           |
| 无 `user_` 前缀 | `user_id` 列已经表达「按用户隔离」，前缀不增加信息；全仓 64 张表里 43 张无前缀（`accounts`、`health_events`、`user_settings` 都带 `user_id`，可见前缀并不承载「是否按用户隔离」） |
| 复数            | 全仓 64 张表无一例外都是复数                                                                                                                                                      |
| snake_case      | 与 `@@map` 全仓一致                                                                                                                                                               |

与其他候选的对比：

- `layouts` —— 会与端点 `/layouts` 形成两套标准：端点认为「布局是独立资源线」，
  表却认为「它是用户的从属数据」。某个判断只要两边不一致，至少有一边是错的。
- `ui_layouts` —— `ui` 是客户端概念，后端表名不该表达渲染层的关注点。
- `surface_layouts` —— 用 `surface` 当限定词是可以的，但主语应是**归属方**（用户），
  而不是它被渲染到哪里。screen 上的东西都是 surface，这个限定不提供信息。

> **2026-10-30 修订**：初稿表名写的是 `layouts`（`user_` 前缀 + 端点独立前缀），
> 两者用两套判断标准且互相矛盾。经裁决统一为 `layouts`，与端点对齐。

### 3.3 索引

唯一索引 `(user_id, surface)` 同时承担两件事：

- 唯一性约束；
- `GET /layouts` 按 `user_id` 查全部 surface 的覆盖索引，无需额外索引。

不需要单独索引 `updated_at` 或 `version`：没有按它们查询的场景。

### 3.4 关联

`User` 侧需要加反向关系：

```prisma
// prisma/models/user.prisma
model User {
  // ...
  layouts UserLayout[]
}
```

## 四、模块与实现

### 4.1 落点

新增模块 `src/modules/layouts/`，路由前缀 **`layouts`**（挂在 `/api/v1/layouts`）。

**为什么不挂在 `/user/layouts`**：现有 81 个 `/user/*` 端点里，绝大多数是
「用户的身体数据」（记录、事件、用药、报告）。布局是**应用偏好**，与
`/user/settings`、`/user/notification-preferences` 同类，但那两个的归属本身
就是 `user` 域的读模型。布局自成一条资源线，独立前缀更清晰。

（若要严格对齐 `/user/settings` 的先例，也可用 `/user/layouts`；这属于口味问题，
本文选择独立前缀，因为 `surface` 是路径参数，`/user/layouts/:surface` 会显得过深。）

### 4.2 分层（ADR-0024 四层）

```text
src/modules/layouts/
  domain/
    layout/
      layout.ts                 # LayoutDoc 聚合根：version / schemaVersion / payload
      schema-version.ts         # 支持区间校验（纯规则）
    user-layouts.ts             # 仓储端口
  application/
    use_cases/
      read-layouts.ts           # 读全部 / 读单个
      save-layout.ts            # 乐观写入 + 冲突判定
  adapters/
    http/
      layouts.controller.ts
      dto/save-layout.ts        # zod schema
  infrastructure/
    persistence/
      user-layouts.ts           # PrismaUserLayouts（实现端口）
  layouts.module.ts
  index.ts                      # barrel：只导 controller 需要外部的东西
  README.md
```

### 4.3 端点清单

| 方法 | 路径                | operationId   | 说明                                                      |
| ---- | ------------------- | ------------- | --------------------------------------------------------- |
| GET  | `/layouts`          | `listLayouts` | 返回全部 surface 的布局；无记录的 surface 不出现在 map 里 |
| GET  | `/layouts/:surface` | `getLayout`   | 单个 surface；不存在返回 404                              |
| PUT  | `/layouts/:surface` | `saveLayout`  | 创建或更新；`ifVersion` 冲突返回 409                      |

全部需要登录（`@UseGuards` 或类级鉴权姿态，AST 约定检查要求显式）。

### 4.4 错误码

沿用 `src/common/api/problem-catalog.ts` 的稳定 code 注册表：

| 场景                         | HTTP | `code`                              |
| ---------------------------- | ---- | ----------------------------------- |
| `surface` 不属于已知枚举     | 400  | `LAYOUT_SURFACE_UNKNOWN`            |
| `schemaVersion` 超出支持区间 | 422  | `LAYOUT_SCHEMA_VERSION_UNSUPPORTED` |
| `ifVersion` 与当前不符       | 409  | `LAYOUT_VERSION_CONFLICT`           |
| 布局不存在                   | 404  | `LAYOUT_NOT_FOUND`                  |

409 响应体带 `current: LayoutDoc`，客户端据此覆写本地缓存并提示。

### 4.5 生成式布局端点（暂缓）

客户端计划里另有 `POST /layouts/:surface/generate`（AI 按自然语言生成 A2UI 组件树，SSE）。
**本计划不含它**，理由：

- 它依赖客户端先生成式组件落地，且是流式（SSE）端点，形态与 CRUD 完全不同；
- 它需要 LLM 调用、配额、审计，属于 `assistant` 域的范畴，不该混进布局存储模块。

等客户端生成式 UI 就绪后单独立项。

## 五、客户端配合（`Luminous` 侧）

本计划只需保证契约正确。客户端侧对应改动已在
`Luminous/plans/2026-10-28-composable-tabs.md` §2.7 定义，落地时：

1. `Lucent` 跑 `pnpm export:openapi`；
2. `Luminous` 跑 `dart run scripts/contract/bootstrap.dart` 重新生成客户端；
3. 把 `LayoutRemote` 的占位实现（`lib/features/customizer/data/datasources/layout_remote.dart`）
   换成真实调用——该类是唯一的接触点，domain/application/UI 都不需要改。

离线写入走客户端既有 `pending_sync_queue`（`entityType = 'ui_layout'`），由 `SyncWorker`
重放；`ifVersion` 记在队列载荷里。

## 六、验收

- [ ] e2e：跨用户访问他人布局 → 404（本仓每个资源端点的强制用例）
- [ ] e2e：`ifVersion` 不匹配 → 409 且响应含 `current`
- [ ] e2e：`schemaVersion` 越界 → 422
- [ ] e2e：未知 `surface` → 400
- [ ] 单测：`schema-version.ts` 的区间边界（`MIN-1` / `MIN` / `MAX` / `MAX+1`）
- [ ] 单测：`save-layout` 在 `ifVersion` 为空时创建、存在时递增
- [ ] `pnpm export:openapi` 后 `docs/reference/generated/openapi.json` 含三个新 operation
- [ ] 删除账号时布局随 `onDelete: Cascade` 一并清理（已有 e2e 覆盖删除路径）

## 七、估时

| 项                                   | 估计     |
| ------------------------------------ | -------- |
| schema + migration                   | 0.5 天   |
| domain / application / adapters 骨架 | 1 天     |
| 三个端点 + 错误映射                  | 1 天     |
| 测试（e2e + 单测）                   | 1 天     |
| OpenAPI 导出与客户端联调             | 0.5 天   |
| **合计**                             | **4 天** |

## 八、开放问题

1. **`surface` 是否该做枚举约束**。当前设计用 `String` 不设外键，好处是新增 surface
   免迁移。代价是脏数据可能写进表里。建议在 `save-layout` 的 zod schema 里用 `z.enum`
   挡住，数据库层保持宽松——校验放在应用层，与「服务端不解释 payload」的分工一致。
2. **是否需要 `GET /layouts` 的 ETag / If-None-Match**。六个 surface 的文档总量很小
   （估计 < 10 KB），首次实现不做；若实测流量偏高再加。
3. **`tab_chrome` 的 `payload` 形状**由客户端定义（`[{tabId, customLabel?, iconName, orderIndex, visible}]`），
   服务端不校验。这意味着 tab 自定义文本也进了数据库——与用户昵称同性质，
   属于「用户输入的数据」而非 UI 文案，不受 l10n 铁律约束。
