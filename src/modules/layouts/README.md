# layouts — user interface layout storage

界面布局的后端权威副本。客户端（`Luminous`）让用户决定「每个 tab 挂哪些组件、什么顺序、
多大尺寸」，本模块只负责把那份文档存下来并保证多设备一致。

## 边界

**做什么**

- 按 `(user, surface)` 存取布局文档
- 校验文档形状版本在支持区间内
- 乐观并发：`ifVersion` 不匹配时以 409 拒绝，并带回当前文档

**不做什么**

- **不解释 `payload`**。组件 id、顺序、尺寸、tab 自定义文本全部由客户端定义。
  服务端解析它就等于把布局格式的演进绑到后端发布节奏上。
- **不做合并**。布局是有序列表，两个不同顺序没有「正确的合并结果」。
- **不渲染**。本模块没有任何 UI 概念，`surface` 对它只是一个字符串。
- **不删除**。布局随用户级联删除（`onDelete: Cascade`）；「恢复默认」由客户端写入默认布局，
  不需要删行。

## 契约

```text
GET  /layouts              → { surfaces: { <surface>: LayoutDoc } }
GET  /layouts/:surface     → LayoutDoc | 404
PUT  /layouts/:surface     → 200 LayoutDoc | 409 {errors:{current}} | 422

LayoutDoc = { surface, version, schemaVersion, payload, updatedAt }
```

| operationId   | 端点                    |
| ------------- | ----------------------- |
| `listLayouts` | `GET /layouts`          |
| `getLayout`   | `GET /layouts/:surface` |
| `saveLayout`  | `PUT /layouts/:surface` |

`surface` 取值：`today` / `record` / `medicine` / `review` / `mine` / `tab_chrome`。

### 为什么挂在 `/layouts` 而不是 `/user/layouts`

`surface` 本身已经是路径参数，`/user/layouts/:surface` 会显得过深。更重要的是布局是
**应用偏好**而非「用户的身体数据」——后者占了 `/user/*` 的绝大多数。数据库表同样是
`layouts`，与端点同名：**表就是资源**。

### 为什么 `tab_chrome` 和页面布局共用资源

两者在数据形态上完全一致：一个有序的配置文档。共用一套端点省掉三个接口，
只是 `payload` 结构不同。

### 为什么是 `PUT` 而不是 `PATCH`

布局是整体替换语义。用户拖一次组件，整份布局就变了；部分更新既表达不了顺序变化，
也让客户端与服务端的差异更难推理。

## 错误码

| 场景                 | HTTP | code                                |
| -------------------- | ---- | ----------------------------------- |
| 未知 `surface`       | 400  | `LAYOUT_SURFACE_UNKNOWN`            |
| `schemaVersion` 越界 | 422  | `LAYOUT_SCHEMA_VERSION_UNSUPPORTED` |
| `ifVersion` 不匹配   | 409  | `LAYOUT_VERSION_CONFLICT`           |
| 该 surface 无布局    | 404  | `RESOURCE_NOT_FOUND`                |

409 把当前文档放在 Problem Details 的 `errors.current` 里，客户端据此直接覆写本地缓存。
放在 `errors` 是因为异常过滤器只转发白名单字段，任意顶层键会被丢弃。

## 结构

```text
domain/layout/
  layout.ts          聚合根规则：形状校验、版本前置条件、下一版本号
  schema-version.ts  支持区间（MIN/MAX）与判定
  surface.ts         封闭的 surface 词表（与客户端 SurfaceId.wireValue 对齐）
  layouts.ts         仓储端口（findByUser / findOne / upsert）
application/use_cases/
  read-layouts.ts    list / get
  save-layout.ts     形状校验 → 前置条件 → 写入
adapters/http/
  layouts.controller.ts
  dto/response.ts    zod schema
  dto/save-layout.ts
infrastructure/persistence/
  layouts.ts         PrismaLayouts
```

无缓存层：布局在应用启动时读一次、用户显式操作时写一次，加缓存只会引入失效问题。
（`user-settings` 有缓存是因为它几乎出现在每个请求路径上，布局不是。）

## 演进约束

**`schemaVersion` 什么时候要 bump**：只有当旧客户端会**误渲染**新文档时才需要。
单纯给 `payload` 加可选字段不必 bump——所有客户端忽略不认识的键，服务端根本不看内容。

**增加 surface**：改 `domain/layout/surface.ts` 的词表即可，不需要迁移——`surface` 列是
无外键的纯字符串，校验在请求 schema 里。这是「服务端不解释 payload」的必然配套。

**读路径会丢弃未知 surface 的行**：可能来自更新的客户端或已下线的 surface。
不丢弃会让 `GET /layouts` 的结果取决于最后写入者是谁。

## 测试

- `domain/layout/layout.spec.ts` — 形状校验、版本前置条件、`nextVersion`
- `domain/layout/schema-version.spec.ts` — 区间边界（MIN-1 / MIN / MAX / MAX+1）
- `test/layouts/` — e2e：跨用户 404、版本冲突 409、`schemaVersion` 422、未知 surface 400
