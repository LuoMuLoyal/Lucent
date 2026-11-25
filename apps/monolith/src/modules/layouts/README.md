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
  但 `tab` 是数组，收窄类型会强迫服务端知道「哪个 surface 是哪种形状」。
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

`surface` 取值：`today` / `record` / `medicine` / `review` / `mine` / `tab`。

### 为什么挂在 `/layouts` 而不是 `/user/layouts`

`surface` 本身已经是路径参数，`/user/layouts/:surface` 会显得过深。更重要的是布局是
**应用偏好**而非「用户的身体数据」——后者占了 `/user/*` 的绝大多数。数据库表同样是
`layouts`，与端点同名：**表就是资源**。

### 为什么 `tab` 和页面布局共用资源

两者在数据形态上完全一致：一个有序的配置文档。共用一套端点省掉三个接口，
只是 `payload` 结构不同。

`tab` 存的是底部 tab 的用户偏好（顺序 / 名称 / 图标 / 显隐），对应
`PUT /layouts/tab`。名字就是 `tab`——它就是这个资源，不加 `_chrome` 之类的
限定词，也不加 `/user` 前缀。

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
（`settings` 有缓存是因为它几乎出现在每个请求路径上，布局不是。）

## 实现时踩到的两个坑（都不是显而易见的）

1. **`updatedAt` 必须是 ISO 字符串，不能直接返回 `Date`。**
   NestJS 12 的 `@SerializeOptions({ schema })` 会用 zod schema **解析**返回值，
   而 `z.string()` 拒绝 `Date`。列表与单条都要过 `toWire` —— 只转一处时，另一处
   会在运行时抛 `Serialization failed: expected string, received Date`。

2. **`payload` 不能声明成 `z.record`。**
   `tab` 的文档是数组（`[{tabId, customLabel, orderIndex, visible}]`），
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
- `test/e2e/layouts/` — e2e：跨用户 404、版本冲突 409、`schemaVersion` 422、未知 surface 400；`generate.e2e-spec.ts` 覆盖两个生成式端点（帧序、信封拒绝、回合参数、语言转发）。

## 生成式端点（A2UI 1.0）

两个端点，同一套 SSE 帧：`/generate` 从一句指示起一棵树，`/turn` 把一次交互的结果
续写到**同一棵**树上。

```text
POST /layouts/:surface/generate
  body: { prompt: string, range?: "7d" | "30d", capabilities?: object }
  → 200 text/event-stream
       event: chunk  data: <一条 A2UI v1.0 agent→renderer 消息>
       event: result data: { surface, messages, usage }
       event: error  data: ProblemDetails
       event: done   data: {}

POST /layouts/:surface/turn
  body: { messages: object[], document: { messages: object[], dataModel?: object },
          capabilities?: object }
  → 200 text/event-stream（同上四帧）
```

| operationId             | 端点                              |
| ----------------------- | --------------------------------- |
| `generateLayoutSurface` | `POST /layouts/:surface/generate` |
| `runLayoutSurfaceTurn`  | `POST /layouts/:surface/turn`     |

`surface` 只接受 `today` / `record` / `medicine` / `review` / `mine` ——
`tab` 是底部栏不是页面，生成一棵树没有地方挂。这与存储端点的六值词表
**故意不同**：两件事回答的是不同问题。

### 为什么在 layouts 而不是 assistant

判据是**产物归属**，不是实现手段。产物是一份可持久化的界面文档（与 `PUT` 存的
`payload` 同性质），不是对话消息。`analysis` 同样调 LLM 却自成模块 ——
「要调模型」不等于「属于 assistant 域」。

### 词汇表由客户端下发，服务端不存第二份

`capabilities` 是客户端的 A2UI renderer capabilities 文档（`{ "1.0": {
supportedCatalogIds, inlineCatalogs } }`）。提示词的组件段落**由它生成**：加一个客户端
组件不需要服务端发版。服务端对这个文档只有三条形状检查——是对象、可序列化、序列化后
不超过 `GENERATIVE_CAPABILITIES_MAX_BYTES`（256 KiB）。**不看组件名，不看属性。**

服务端不提供兜底词表：客户端没发 capabilities 时提示词只说「按协议用通用布局组件」，
而不是编一份清单——否则清单又成了第二份事实源。

### 准入：只剩信封结构

v0.9 时代的 `surface-policy.ts` 有三条内容规则（禁数值、禁写动作、finding 只认 id）。
**1.0 起整份删除**：客户端的 catalog 是全量的（Button / TextField / Slider / Modal 都在
注册表里），agent 下发的可写动作是用户本来就要点的。现在留下的检查在
`domain/generative/a2ui-envelope.ts`：

| 检查                                 | 为什么                                                       |
| ------------------------------------ | ------------------------------------------------------------ |
| 每条消息是对象、`version` 为 `"1.0"` | v1.0 的 `@path` 绑定与 v0.9 不通用，混版本两边都不认         |
| 恰好一个 body key（六个之一）        | 一条消息带两个变体，解析器只能猜                             |
| 有 `createSurface`                   | 没有它，后续消息找不到 surface                               |
| 有 `id == "root"` 的组件             | 没有根，渲染出来是空白页，看起来像「生成成功但什么都没生成」 |

违规仍让**整次生成失败**（`GENERATIVE_OUTPUT_REJECTED`，502），而不是剔除坏消息：
半棵树配上一个能显示的页码，比一块明确的失败更难排查。

六个 body key 是 v1.0 的：`createSurface` / `updateComponents` / `updateDataModel` /
`deleteSurface` / **`callRendererFunction`** / **`agentFunctionResponse`**（后两个是 1.0
新增的双向函数调用）。

### 交互回合：服务端无状态

`/turn` 每次带**完整文档**（消息序列 + 可选 dataModel）与渲染端产出的消息。这换来三件事：

- 重启不丢东西；
- 第二台设备用自己那份继续，不需要对账；
- 没有会话过期、淘汰、跨用户串会话要推理。

代价是每轮多传一份文档。比起维护会话存储，这是更便宜的选择。

**`result` 是完整序列，不是增量**：客户端拿它覆盖同一 surface。这样一次丢帧可以自愈，
也不用区分「首次生成」与「续写」。

### 语言

错误文案与**模型生成的展示文字**都跟随客户端的 `Accept-Language`
（支持 `zh-CN` / `en`，兜底 `en`）。`@I18nLang()` 取到的语言既进
`SseProblemDetailsMapper`（错误），也进提示词（生成内容）。

进提示词前必须归一化（`toContentLocale`）：浏览器常发
`zh-CN,zh;q=0.9,en;q=0.8` 这样的加权串，直接塞进去会诱发中英混杂输出。

**「值」与「键」分开**：展示文字跟随语言，`component` 名与 `kind` / `kinds` /
`range` / `findingId` 的取值必须保持固定 ASCII —— 否则模型会把 `water`
「翻译」成中文，整棵树解析不了。`finding` 的文案来自后端原文，**不翻译**。

## 生成式的结构

```text
domain/generative/
  generation-request.ts  请求校验（surface 可生成性、prompt 边界、capabilities 上限）
  a2ui-envelope.ts       A2UI v1.0 消息信封检查（结构，纯函数）
  generated-surface.ts   产物值类型（消息序列 + usage）
application/
  ports/surface-generator.ts   模型端口（首次生成 + 交互回合）
  use_cases/generate-surface.ts  校验 → 可用性 → 生成 → 信封检查
  use_cases/continue-surface.ts  同上，输入换成「消息 + 文档」
adapters/http/dto/
  generate-surface.ts    两个端点的请求 schema + 流式响应 schema（带 describe/example）
infrastructure/llm/
  surface-generator.ts   LlmSurfaceGenerator（extends BaseLlmGeneratorService）
  prompts/surface.ts     系统提示词（由 capabilities 生成词汇表）与 toContentLocale
  schemas/surface.ts     模型结构化输出 schema
```

### 流式怎么工作

`BaseLlmGeneratorService.generateStream` 每收到一个 chunk 就解析一次部分输出。
`messages` 是数组，部分解析会给出「若干完整元素 + 一个正在写的元素」，所以生成器
按**已转发条数**推进，只转发完整的那些 —— 这正是控制器写 `event: chunk` 所需的粒度。
重复或跳过都会让客户端重放缓冲区错位。

`summary` 字段只服务于基类的进度回调，不出网。

### 与客户端的契约

服务端不再维护组件词汇表，两边唯一的对账点是客户端的 `capabilities` 文档。原先守
「服务端词表 = 客户端词表」的那份契约 e2e 随规则一起删除：那份约束的前提（服务端也有
一份清单）已经不存在。

## 生成式错误码

| 场景                    | HTTP | code                                |
| ----------------------- | ---- | ----------------------------------- |
| 未知 `surface`          | 400  | `LAYOUT_SURFACE_UNKNOWN`            |
| `tab` 不可生成          | 400  | `GENERATIVE_SURFACE_UNSUPPORTED`    |
| 空指示                  | 400  | `GENERATIVE_PROMPT_EMPTY`           |
| 指示过长                | 422  | `GENERATIVE_PROMPT_TOO_LONG`        |
| capabilities 不可序列化 | 400  | `GENERATIVE_CAPABILITIES_INVALID`   |
| capabilities 超上限     | 422  | `GENERATIVE_CAPABILITIES_TOO_LARGE` |
| 回合没有消息            | 422  | `GENERATIVE_TURN_EMPTY`             |
| 回合消息过多            | 422  | `GENERATIVE_TURN_TOO_LARGE`         |
| 回合没有文档            | 422  | `GENERATIVE_DOCUMENT_EMPTY`         |
| 模型输出不是合法 v1.0   | 502  | `GENERATIVE_OUTPUT_REJECTED`        |
| 未配置模型              | 503  | `LLM_NOT_CONFIGURED`                |

**为什么空回合是 422 而不是 400**：请求体解析得了，只是它描述不了任何要回应的事。
DTO 因此**不在 `messages` 上加 `.min(1)`** —— schema 层的下界会把领域码挡成通用的
`VALIDATION_FAILED` 400，客户端就丢失了「你这次交互没带操作」这条信息。
