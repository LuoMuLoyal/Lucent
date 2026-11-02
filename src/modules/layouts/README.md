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
  `payload` 的 TS 类型是 `unknown` 而不是 `Record<string, unknown>`：页面布局是对象，
  但 `tab_chrome` 是数组，收窄类型会强迫服务端知道「哪个 surface 是哪种形状」。
- **不做合并**。布局是有序列表，两个不同顺序没有「正确的合并结果」。
- **不渲染**。本模块没有任何 UI 概念，`surface` 对它只是一个字符串。
- **不删除**。布局随用户级联删除（`onDelete: Cascade`）；「恢复默认」由客户端写入默认布局，
  不需要删行。
- **生成式端点不落库**。`POST /layouts/:surface/generate` 只产出一次 A2UI 消息序列并流式
  返回；结果由客户端写本地。生成物是**可重生成的展示缓存**，不是需要多设备一致的权威
  文档——为它建表、加版本号、做冲突合并，是在为缓存付权威副本的代价。

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

## 实现时踩到的两个坑（都不是显而易见的）

1. **`updatedAt` 必须是 ISO 字符串，不能直接返回 `Date`。**
   NestJS 12 的 `@SerializeOptions({ schema })` 会用 zod schema **解析**返回值，
   而 `z.string()` 拒绝 `Date`。列表与单条都要过 `toWire` —— 只转一处时，另一处
   会在运行时抛 `Serialization failed: expected string, received Date`。

2. **`payload` 不能声明成 `z.record`。**
   `tab_chrome` 的文档是数组（`[{tabId, customLabel, orderIndex, visible}]`），
   `z.record` 会把它当 400 拒掉。正确做法是 `z.unknown()` + 只拒绝 `undefined`/`null`。

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

## 生成式端点：`POST /layouts/:surface/generate`

按用户的自然语言指示，让模型在**受限词汇表**内拼装一棵 A2UI 树，以 SSE 流式返回。

```text
POST /layouts/:surface/generate
  body: { prompt: string, range?: "7d" | "30d" }
  → 200 text/event-stream
       event: chunk  data: <一条 A2UI 消息>
       event: result data: { surface, messages, usage }
       event: error  data: ProblemDetails
       event: done   data: {}
```

| operationId             | 端点                              |
| ----------------------- | --------------------------------- |
| `generateLayoutSurface` | `POST /layouts/:surface/generate` |

`surface` 只接受 `today` / `record` / `medicine` / `review` / `mine` ——
`tab_chrome` 是底部栏不是页面，生成一棵树没有地方挂。这与存储端点的六值词表
**故意不同**：两件事回答的是不同问题。

### 为什么在 layouts 而不是 assistant

判据是**产物归属**，不是实现手段。产物是一份可持久化的界面文档（与 `PUT` 存的
`payload` 同性质），不是对话消息。`today-analysis` 同样调 LLM 却自成模块 ——
「要调模型」不等于「属于 assistant 域」。

### 三条安全边界

模型只决定**展示什么、怎么排**，不决定数值，也不能生成动作：

| 风险            | 落点                                                                            |
| --------------- | ------------------------------------------------------------------------------- |
| AI 编造健康数值 | `domain/generative/surface-policy.ts`：领域组件只接受引用键，任何数值一律判违规 |
| AI 生成可写动作 | catalog 不含 `Button` / `TextField` / 表单                                      |
| AI 改写医学结论 | `finding` 只接受 `findingId`，任何文案属性都在白名单外                          |

提示词让违规**不太可能**，准入校验让违规**不可能上线**。违规时**整次生成失败**
（`GENERATIVE_OUTPUT_REJECTED`），而不是剔除坏组件继续——剔除等于替模型猜意图，
而最危险的一类（编造数值）被悄悄删掉后，剩下的内容会显得像完整结论。

### 语言

错误文案与**模型生成的展示文字**都跟随客户端的 `Accept-Language`
（支持 `zh-CN` / `en`，兜底 `en`）。`@I18nLang()` 取到的语言既进
`SseProblemDetailsMapper`（错误），也进提示词（生成内容）。

进提示词前必须归一化（`toContentLocale`）：浏览器常发
`zh-CN,zh;q=0.9,en;q=0.8` 这样的加权串，直接塞进去会诱发中英混杂输出。

**「值」与「键」分开**：展示文字跟随语言，`component` 名与 `kind` / `kinds` /
`range` / `findingId` 的取值必须保持固定 ASCII —— 否则模型会把 `water`
「翻译」成中文，整棵树解析不了。

`finding` 是唯一例外：它的文案来自后端原文，**不翻译**。

## 生成式的结构

```text
domain/generative/
  generation-request.ts  请求校验（surface 可生成性、prompt 边界）+ 纯失败形状
  surface-policy.ts      A2UI 消息准入规则（安全边界，纯函数）
  generated-surface.ts   产物值类型（消息序列 + usage）
application/
  ports/surface-generator.ts  模型端口
  use_cases/generate-surface.ts  校验 → 可用性 → 生成 → 准入
adapters/http/dto/
  generate-surface.ts    请求 schema + 流式响应 schema（带 describe/example）
infrastructure/llm/
  surface-generator.ts   LlmSurfaceGenerator（extends BaseLlmGeneratorService）
  prompts/surface.ts     系统提示词（词汇表 + 语言规则）与 toContentLocale
  schemas/surface.ts     模型结构化输出 schema
```

### 流式怎么工作

`BaseLlmGeneratorService.generateStream` 每收到一个 chunk 就解析一次部分输出。
`messages` 是数组，部分解析会给出「若干完整元素 + 一个正在写的元素」，所以生成器
按**已转发条数**推进，只转发完整的那些 —— 这正是控制器写 `event: chunk` 所需的粒度。
重复或跳过都会让客户端重放缓冲区错位。

`summary` 字段只服务于基类的进度回调，不出网。

### 与客户端的契约

服务端提示词里的组件词汇表必须与客户端 `GenerativeCatalog.typeNames` 一致。
两边各存一份（跨端共享包要求后端引入 TS 共享包，超出本模块范围），靠测试快照对账。
