# Lucent 代码审查报告（后端 NestJS）

**审查时间**: 2026-06-29  
**审查范围**: Lucent dev 分支  
**审查模型**: DeepSeek V4 Pro + 人工复核  
**审查原则**: 严格按文档、严格按既有模式、严格按风格一致性

---

## 📋 未解决问题汇总（截至 2026-06-29）

| #   | 问题                                                        | 状态      | 涉及文件/模块                                          |
| --- | ----------------------------------------------------------- | --------- | ------------------------------------------------------ |
| B1  | Apple OAuth 直接使用 jsonwebtoken 而非项目已有的 JwtService | 🔴 未修复 | `auth/providers/apple-oauth.provider.ts`               |
| B2  | MedicineService JSON 解析空 catch 吞异常                    | 🔴 未修复 | `medicines/medicines.service.ts`                       |
| B3  | shuffleArray 使用有偏的 sort+random 算法                    | 🔴 未修复 | `medicines/medicines.service.ts`                       |
| B4  | 手动映射 Prisma 全部字段                                    | 🔴 未修复 | `user-health-context/services/mapper.service.ts`       |
| B5  | calculateAge 时区混合问题                                   | 🔴 未修复 | `user-health-context/services/mapper.service.ts`       |
| B6  | 文件上传缺少路径穿越/大小/空值校验                          | 🔴 未修复 | `files/files.service.ts`                               |
| B7  | ALLOWED_IMAGE_TYPES 硬编码在 service 内                     | 🔴 未修复 | `files/files.service.ts`                               |
| B8  | 错误消息未使用 i18n                                         | 🔴 未修复 | `files/files.service.ts`                               |
| B9  | 服务文件位置不统一（11个模块在根目录）                      | 🔴 未修复 | 11个模块                                               |
| B10 | Guard 目录滥用（ownership.service 不是 Guard）              | 🔴 未修复 | daily-records, medicine-reminders, user-health-context |
| B11 | 路由前缀不统一（11个加 user/，6个不加）                     | 🔴 未修复 | 全项目 Controller                                      |
| B12 | ownership 服务重复实现                                      | 🔴 未修复 | 3个 ownership.service.ts                               |
| B13 | 模块导出标准缺失                                            | 🔴 未修复 | 全项目 module.ts                                       |
| B14 | files dto 缺少 index.ts                                     | 🔴 未修复 | `files/dto/`                                           |
| B15 | auth/dto/responses/ 嵌套破坏扁平化                          | 🔴 未修复 | `auth/dto/responses/`                                  |
| B16 | llm-runtime 和 user 模块无 Controller                       | 🔴 未修复 | `llm-runtime/`, `user/`                                |
| B17 | mapper 命名碎片化                                           | 🔴 未修复 | 3个 mapper.service.ts                                  |
| B18 | systemPrompt 硬编码中文                                     | 🔴 未修复 | `medicines/medicines.service.ts`                       |
| B19 | `files` 模块完全无测试                                      | 🔴 未修复 | `files/*.ts`                                           |
| B20 | `user-health-context` 测试严重不足（7服务2测试）            | 🔴 未修复 | `user-health-context/`                                 |
| B21 | `daily-records` 测试不足（7服务3测试）                      | 🔴 未修复 | `daily-records/`                                       |
| B22 | docs 目录缺少架构设计文档和开发指南                         | 🟡 未修复 | `docs/`                                                |
| B23 | E2E 测试数据清理不彻底                                      | 🟡 未修复 | `test/e2e/`                                            |
| B24 | Mock 粒度过大，未验证调用参数                               | 🟡 未修复 | 多个测试文件                                           |
| B25 | 单元测试未覆盖 Prisma 返回 null 场景                        | 🟡 未修复 | 多个测试文件                                           |
| B26 | eval/Function 使用（adminjs.setup.ts）                      | 🔴 未修复 | `src/admin/adminjs.setup.ts`                           |
| B27 | AI Generator 服务重复（reports/today-analysis）             | 🔴 未修复 | `reports/`, `today-analysis/`                          |
| B28 | AI Service 主流程重复                                       | 🟡 未修复 | `reports/`, `today-analysis/`                          |
| B29 | AI 分析流程架构差异（4模块不一致）                          | 🟡 未修复 | assistant, reports, today-analysis, daily-records      |
| B30 | Stream 解析的 any 类型                                      | 🟡 未修复 | `reports-ai-summary-generator.service.ts`              |

---

## 第一部分：代码级审查

### 文件 1：`src/modules/auth/providers/apple-oauth.provider.ts`

#### 问题 1.1【严重】重复造轮子 / 不遵循既有模式

- **问题描述**：直接使用 `jsonwebtoken` 和 `crypto.createPublicKey` 手动实现 JWT 验证逻辑，而项目中已有统一的 `JwtService`（来自 `@nestjs/jwt`）和对应的封装（如 `auth-token.service.ts`）。该行为违背了"已有 JWT 相关工具/装饰器/守卫，还自己实现"的原则。
- **代码位置**：文件中引入 `import jwt from 'jsonwebtoken';` 并调用 `jwt.decode()` 和 `jwt.verify()`，以及使用 `createPublicKey` 处理 JWKS。
- **期望修复**：复用已有的 `JwtService` 或通过封装类完成 Apple JWT 验证，保持 JWT 处理逻辑集中且可审计。
- **参考依据**：项目中现有 `src/modules/auth/services/auth-token.service.ts`（或其封装的 `JwtService` 使用方式）。

#### 问题 1.2【严重】风格不一致

- **问题描述**：导入顺序混乱，第三方库（`jsonwebtoken`）与本项目模块的导入分组不清；使用了默认导入 `jwt from 'jsonwebtoken'` 而其他模块可能使用命名导入，与项目统一规范不符合。
- **代码位置**：文件头部导入部分。
- **期望修复**：统一采用 NestJS 推荐的导入分组顺序（Node 内置 > 第三方 > 项目内部），并保持导入风格一致。
- **参考依据**：其他模块（如 `auth-token.service.ts`）的导入组织方式。

#### 问题 1.3【严重】代码质量 - 魔法字符串/常量

- **问题描述**：Apple JWKS 地址和签发者直接硬编码为字符串常量 `'https://appleid.apple.com/auth/keys'` 和 `'https://appleid.apple.com'`，未从配置或常量文件中读取。
- **代码位置**：`const APPLE_JWKS_URL = ...`、`const APPLE_ISSUER = ...`。
- **期望修复**：将其移至配置文件或常量定义，通过 `ConfigService` 获取，便于维护和多环境切换。
- **参考依据**：项目中使用 `ConfigKey` 枚举和 `OAuthConfig` 配置模式。

---

### 文件 2：`src/modules/medicines/medicines.service.ts`

#### 问题 2.1【严重】错误处理

- **问题描述**：`JSON.parse` 异常捕获后 catch 块为空 `catch { /* fall through */ }`，导致解析失败时函数静默返回 `undefined`，且无任何日志或提示，违反异常必须处理的原则。
- **代码位置**：`recognizeMedicine` 方法中的 try-catch。
- **期望修复**：至少记录错误日志，或根据业务需求抛出可处理的业务异常。
- **参考依据**：项目统一的 API 错误处理规范（如 `api-errors.ts`）。

#### 问题 2.2【严重】代码质量 - 洗牌算法不正确

- **问题描述**：`shuffleArray` 方法使用 `sort(() => Math.random() - 0.5)` 排序，得到的结果并非均匀随机分布，且该方式已被广泛认为是不正确的洗牌实现。
- **代码位置**：`private shuffleArray<T>(...)` 方法。
- **期望修复**：采用 Fisher-Yates 洗牌算法或使用已有的工具函数。
- **参考依据**：通用工具函数可能存在随机化方法，若无，应编写标准洗牌函数。

#### 问题 2.3【严重】代码质量 - 魔法字符串

- **问题描述**：`systemPrompt` 为一段长中文提示语，硬编码在方法中，不利于维护和国际化。
- **代码位置**：`const systemPrompt = \`你是一个药品识别助手...\`;`。
- **期望修复**：将提示语提取到常量、配置或 i18n 资源中，并使用已有的 `I18nService`（如果适用）。
- **参考依据**：项目使用 `nestjs-i18n`，提示内容应纳入多语言体系。

#### 问题 2.4【严重】安全与性能 - 缺少输入校验

- **问题描述**：AI 调用前未对传入内容进行任何长度、内容或格式校验，可能导致注入或滥用；同时未限制调用频次，存在资源耗尽风险。
- **代码位置**：`model.invoke([...])` 之前的准备阶段。
- **期望修复**：增加输入校验（如最大长度、禁止内容模式），并考虑使用速率限制或业务层校验。
- **参考依据**：NestJS 推荐使用 `class-validator` 管道，项目已有 DTO 校验模式。

---

### 文件 3：`src/modules/user-health-context/services/user-health-context-mapper.service.ts`

#### 问题 3.1【严重】重复造轮子 / 不遵循既有模式

- **问题描述**：手动逐字段映射 `user.allergies` 等关联数组的每个属性，而 Prisma 查询本身返回的对象结构与所需映射完全一致，这相当于重复了一份无意义的映射层，增加了维护负担。如果有字段新增，此处容易遗漏。
- **代码位置**：映射 `allergies`、`vaccinations` 等集合的 `.map(...)` 部分。
- **期望修复**：直接返回 Prisma 查询结果或使用选择集（select）限定字段，若确实需要转换，可使用工具库（如 `class-transformer`）批量处理，避免手动列出所有字段。
- **参考依据**：Prisma 客户端的使用模式——对象模型由 schema 定义，不应在业务层再手写一份字段映射。

#### 问题 3.2【严重】日期处理不一致 / 重复造轮子

- **问题描述**：`calculateAge` 方法使用 `new Date()`（本地时区）和 `getUTCFullYear` 混合计算年龄，可能导致跨时区边界误差；且项目已有 `date-time.utils.ts` 统一工具，应复用而避免自己实现。
- **代码位置**：`private calculateAge(birthDate: Date | null): number | null`。
- **期望修复**：移除该方法，改用已有的日期工具计算年龄，确保时区一致性和复用。
- **参考依据**：`src/common/utils/date-time.utils.ts`。

#### 问题 3.3【严重】代码质量 - 缺少空值/边界处理

- **问题描述**：`calculateAge` 没有处理 `birthDate` 为空的情况（虽然返回了 `null`），但在调用处可能未对 `null` 进行防护；此外，年龄计算可能产生负数或极端值，未校验合法性。
- **代码位置**：`calculateAge` 的返回及调用链。
- **期望修复**：调用处确保处理 `null` 结果，或由工具函数内部抛出业务异常（如生日不能大于当前日期）。
- **参考依据**：统一的错误处理方式（`api-errors.ts`）。

---

### 文件 4：`src/modules/files/files.service.ts`

#### 问题 4.1【严重】安全 - 输入校验严重缺失

- **问题描述**：
  - `sizeBytes` 未检验是否为正整数（可传入 0 或负数）；
  - `fileName` 未过滤路径遍历字符（如 `../`、`..\`）；
  - `contentType` 仅 trim 和 toLowerCase，但未检查空字符串或非法字符。
- **代码位置**：`createPresignedUpload` 方法开始的处理部分。
- **期望修复**：使用 DTO 装饰器（如 `@IsPositive()`, `@MaxFileSizeValidator`，`@Matches(...)` 禁止路径穿越）在管道中统一校验，或在 service 中明确校验。
- **参考依据**：NestJS 的 `ValidationPipe` 和 DTO 校验模式，项目中已有的 DTO 应已配置 `class-validator`。

#### 问题 4.2【严重】风格不一致 - 常量硬编码

- **问题描述**：`ALLOWED_IMAGE_TYPES` 集合硬编码在 service 内，如果其他模块也需要图片类型校验，会重复定义。
- **代码位置**：if 条件 `!ALLOWED_IMAGE_TYPES.has(contentType)`。
- **期望修复**：将允许的 MIME 类型定义为共享常量或配置，避免各自维护。
- **参考依据**：项目中常见的常量分离模式（如 `constants` 目录）。

#### 问题 4.3【严重】错误处理 - 错误信息泄露实现细节

- **问题描述**：直接抛出 `badRequest('Only jpeg, png, webp, or gif images can be uploaded')` 时将后端允许的类型完全暴露，提供攻击者更多信息；且未使用 i18n 统一错误消息。
- **代码位置**：`badRequest(...)` 调用处。
- **期望修复**：使用标准化错误码（如 `ResultCode`）和 i18n 错误消息，仅返回通用提示。
- **参考依据**：项目已有的 `api-errors` 和 `I18nService`，应通过键值返回国际化消息。

---

## 第二部分：工程化/架构级审查

### 一、目录结构一致性

#### 1.1【严重】服务文件存放位置不统一

**问题描述**：部分模块将服务类放在 `services/` 子目录下，另一部分却直接放在模块根目录，导致项目结构混乱，新增开发者难以定位服务。

**有 services/ 子目录的模块（8个）**：

- `assistant`, `auth`, `daily-records`, `data-export`, `medicine-reminders`, `reports`, `today-analysis`, `user-health-context`

**没有 services/ 子目录的模块（11个）**：

- `account`, `environment`, `files`, `llm-runtime`, `medicines`, `notifications`, `support-resources`, `testing-support`, `user`, `user-settings`, `medicine-dose-logs`

**期望修复**：全项目统一采用 `services/` 子目录存放所有业务服务类。即使模块只有一个服务，也应放入 `services/`，保持目录可预测性。

**参考标准**：`auth/services/`、`assistant/services/`

---

#### 1.2【严重】Guard 目录滥用

**问题描述**：`daily-records`、`medicine-reminders`、`user-health-context` 三个模块在 `guards/` 目录下放置了名为 `ownership.service.ts` 且注释声明"这不是 NestJS Guard"的文件。这严重混淆了 Guard 的概念与目录约定。

**涉及文件**：

- `daily-records/guards/ownership.service.ts` - 注释明确说"NOT a NestJS Guard"
- `medicine-reminders/guards/ownership.service.ts` - 同上
- `user-health-context/guards/ownership.service.ts` - 同上

**期望修复**：

1. 所有权检查逻辑本质是可注入的服务，应迁移至 `services/ownership.service.ts`
2. `guards/` 目录只允许放置实现 `CanActivate` 接口且后缀为 `.guard.ts` 的文件
3. 如果三个模块的 ownership 逻辑相似，抽取为 `common/services/ownership.service.ts`

**参考标准**：`auth/guards/jwt-auth.guard.ts` —— 真正的 NestJS Guard

---

#### 1.3【严重】DTO 导出结构不一致

**问题描述**：

- 多数模块在 `dto/` 下提供 `index.ts` 统一导出
- `files` 模块有 `dto/` 却无 `index.ts`
- `auth/dto/` 下额外嵌套了 `responses/index.ts` 子目录，破坏扁平化导出约定

**涉及文件**：

- `files/dto/`（缺 `index.ts`）
- `auth/dto/responses/`

**期望修复**：

- 所有 `dto/` 目录必须包含 `index.ts`
- `auth/dto/responses/` 应扁平化到 `auth/dto/` 下

**参考标准**：`account/dto/index.ts`、`medicine-dose-logs/dto/index.ts`

---

#### 1.4【严重】子目录种类泛滥且无统一规则

**问题描述**：模块内部子目录种类百花齐放（`config/`, `cache/`, `sources/`, `dashboard/`, `prompts/`, `schemas/`, `tools/`, `agent/`, `types/` 等），缺乏统一的组织模板。

**各模块子目录统计**：
| 模块 | 子目录 |
|------|--------|
| assistant | agent/, dto/, prompts/, schemas/, services/, tools/, types/ |
| auth | config/, decorators/, dto/, guards/, providers/, services/, strategies/, types/ |
| daily-records | config/, dto/, guards/, prompts/, schemas/, services/ |
| data-export | config/, dto/, services/ |
| medicines | cache/, dto/, sources/ |
| reports | dashboard/, dto/, prompts/, schemas/, services/ |
| today-analysis | dto/, prompts/, schemas/, services/ |
| user-health-context | dto/, guards/, services/, types/ |

**期望修复**：制定模块子目录白名单：

- 标准模块：`dto/`, `services/`, `guards/`
- 复杂模块可增：`config/`, `types/`
- 特殊模块可增：`schemas/`(数据库), `prompts/`(AI), `tools/`(Agent)

---

### 二、策略写法一致性

#### 2.1【严重】所有权检查服务重复实现

**问题描述**：三个 `ownership.service.ts` 极可能是相同逻辑的多份拷贝，违反 DRY 原则。

**代码对比**：

- `daily-records/guards/ownership.service.ts`：自己实现 `notFound('Record not found')`
- `medicine-reminders/guards/ownership.service.ts`：使用 `ensureOwnedByUser` helper
- `user-health-context/guards/ownership.service.ts`：使用 `ensureOwnedByUser` helper + `nonDeleted` helper

**期望修复**：

1. 统一使用 `prisma-ownership.helper.ts` 中的 `ensureOwnedByUser`
2. 各模块的 ownership service 应只是一层薄封装，调用统一 helper
3. 或完全移除，直接在 service 中调用 helper

**参考标准**：`common/utils/prisma-ownership.helper.ts`

---

#### 2.2【严重】数据映射服务命名碎片化

**问题描述**：多个模块有 mapper service，但命名和放置不一致。

**涉及文件**：

- `daily-records/services/daily-records-mapper.service.ts`
- `medicine-reminders/services/medicine-reminders-mapper.service.ts`
- `user-health-context/services/user-health-context-mapper.service.ts`

**期望修复**：统一命名规范，如 `{domain}-mapper.service.ts` 或放到 `services/mappers/` 子目录。

---

#### 2.3【严重】错误处理方式不一致

**问题描述**：

- 部分模块使用 `i18n.t('key')` 进行国际化错误消息
- 部分模块直接硬编码英文错误消息
- `daily-records` 的 ownership service 直接写 `'Record not found'`

**期望修复**：所有错误消息统一通过 `i18n` 或 `api-errors.ts` 中的常量管理。

---

### 三、Controller 路由前缀

#### 3.1【严重】路由前缀命名不统一

**问题描述**：模块路由前缀缺乏统一规范，有的加 `user/` 前缀，有的不加。

**路由前缀统计**：
| 前缀模式 | 模块 |
|---------|------|
| `user/xxx` | assistant, daily-records, data-export, files, medicine-dose-logs, medicine-reminders, notifications, reports, today-analysis, user-health-context, user-settings |
| 无 `user/` 前缀 | account, auth, environment, medicines, support-resources, testing-support |

**期望修复**：

- 方案 A：所有用户相关接口统一加 `user/` 前缀，通过 `UserModule` 路由挂载
- 方案 B：使用 `RouterModule` 在模块级别配置前缀，Controller 只声明资源路径
- 当前混合方式最糟糕——有的加有的不加，开发者难以判断

**参考标准**：`auth` 模块（`@Controller('auth')`）和 `account` 模块（`@Controller('account')`）的纯净路径方式

---

#### 3.2【严重】Controller 缺失

**问题描述**：两个模块没有 Controller。

**涉及模块**：

- `llm-runtime`：只有 module + service，没有 controller。如果它是纯内部服务，OK；但如果对外暴露，缺少 controller。
- `user`：只有 module + service，没有 controller。用户管理应该有 CRUD 接口。

**期望修复**：明确这两个模块的设计意图。如果是纯内部服务，应在 module 注释中说明；如果应该对外暴露，补充 controller。

---

### 四、模块导出规范

#### 4.1【严重】模块导出标准缺失

**问题描述**：哪些模块应该 exports 服务，哪些不应该，没有统一标准。

**导出服务的模块**：

- `assistant`：导出 `AssistantConversationService`, `AssistantToolService`
- `auth`：导出 `AuthService`
- `daily-records`：导出 `DailyRecordsService`, `DailyRecordCandidatesService`
- `llm-runtime`：导出 `LlmRuntimeService`
- `medicines`：导出 `MedicinesCacheAdminService`
- `medicine-reminders`：导出 `MedicineRemindersService`
- `notifications`：导出 `NotificationsService`
- `reports`：导出 `ReportsService`
- `user`：导出 `UserService`
- `user-health-context`：导出 `UserHealthContextService`
- `user-settings`：导出 `UserSettingsService`

**不导出服务的模块**：

- `account`, `data-export`, `environment`, `files`, `medicine-dose-logs`, `support-resources`, `testing-support`, `today-analysis`

**期望修复**：制定导出规范：

- 被其他模块依赖的服务必须 exports
- 纯内部服务不 exports
- 当前是否导出应与实际依赖关系一致

---

## 第三部分：AI 服务重复问题（历史遗留，2026-06-26 深度审查）

### 3.1【警告】AI Generator 服务高度重复

**问题描述**：`ReportsAiSummaryGeneratorService` 和 `TodayAnalysisGeneratorService` 结构几乎一致：

- 相同的 `MODEL_OPTIONS` 常量
- 相同的 `hasAnalysisModel()` 方法
- 相同的 `generate()` 方法结构
- 相同的 `generateStream()` 方法结构
- 相同的 `createStructuredOutputModel()` 和 `createStreamingModel()` 私有方法

**差异点**：仅在于 prompt builder、schema 类型和 tool name 不同。

**状态**：🔴 未修复（两个 generator service 仍然存在）

**期望修复**：抽象 `BaseAiGeneratorService<TContext, TPrompt, TOutput>` 基类，子类只需实现 `buildMessages()` 和提供 schema/toolName。

---

### 3.2【警告】AI Service 主流程重复

**问题描述**：`ReportsAiSummaryService` 和 `TodayAnalysisService` 的核心流程完全一致：

- `generate()` → `prepare()` → `generateStructuredOutput()` → `toDataDto()` → `persistSummary()`
- `generateStream()` → 同样的流程但带 stream 回调
- `generateStructuredOutput()` 的 fallback 逻辑完全一致
- `emitGuaranteedSummary()` 方法完全相同

**状态**：🟡 部分改善（Today 和 Reports 流程已比较相似，但未抽取基类）

**期望修复**：抽象 `BaseAiSummaryService<TContext, TOutput, TDataDto>` 基类，将公共流程模板化。

---

### 3.3【警告】AI 分析流程架构差异

**问题描述**：4 个 AI 分析模块（TodayAnalysis、ReportsAiSummary、DailyRecordCandidates、Assistant）架构不一致。

**状态**：🟡 部分改善（Today 和 Reports 已统一，但 DailyRecordCandidates 和 Assistant 仍有差异）

**期望修复**：统一为三层架构（Context → Generation → Policy），新增模块必须遵循。

---

### 3.4【警告】Stream 解析的 any 类型

**问题描述**：`reports-ai-summary-generator.service.ts` 中多处使用 `as unknown` 和 `as { summary?: unknown }`，类型安全差。

**状态**：🟡 未修复

**期望修复**：使用严格的类型守卫函数。

---

## 第四部分：测试覆盖审查

### 4.1【严重】`files` 模块完全无测试

**问题描述**：新增的文件上传模块（`files.controller.ts`, `files.service.ts`）没有任何测试文件，这是安全敏感功能，测试缺失风险极高。

**涉及文件**：

- `src/modules/files/files.controller.ts` — 无测试
- `src/modules/files/files.service.ts` — 无测试
- `src/modules/files/files.module.ts` — 无测试

**期望修复**：

- 为 `files.service.ts` 补充单元测试（重点测试文件上传校验、路径安全、MIME 类型检查）
- 为 `files.controller.ts` 补充集成测试或 e2e 测试
- 测试用例应包含：正常上传、路径穿越、超大文件、非法 MIME、空文件名

---

### 4.2【严重】核心业务模块测试严重不足

**问题描述**：多个复杂模块的服务数量与测试数量严重不匹配。

**测试覆盖统计**：
| 模块 | 服务数 | 测试数 | 覆盖率 | 状态 |
|------|--------|--------|--------|------|
| `user-health-context` | 7 | 2 | ~28% | 🔴 严重不足 |
| `daily-records` | 7 | 3 | ~43% | 🔴 不足 |
| `assistant` | 11 | 8 | ~73% | 🟡 基本可接受 |
| `reports` | 8 | 6 | ~75% | 🟡 基本可接受 |
| `data-export` | 6 | 4 | ~67% | 🟡 略不足 |
| `medicines` | 5 | 4 | ~80% | 🟢 尚可 |
| `today-analysis` | 5 | 4 | ~80% | 🟢 尚可 |
| `files` | 1 | **0** | **0%** | 🔴 **完全缺失** |

**期望修复**：

- `user-health-context`：补充 mapper service、calculateAge 工具、ownership service 的测试
- `daily-records`：补充剩余 4 个服务的测试
- `files`：最优先，安全敏感功能必须补全测试

---

### 4.3【警告】e2e 测试覆盖不均衡

**问题描述**：`test/e2e/` 包含 14 个模块的 e2e 测试，但缺少部分模块的 e2e 覆盖。

**无 e2e 的模块**：

- `medicine-dose-logs` — 有 controller + service，但无 e2e
- `files` — 无测试自然无 e2e

**期望修复**：

- 为 `medicine-dose-logs` 补充 e2e 测试
- 为 `files` 补充 e2e 测试（上传场景）

---

### 4.4【警告】测试文件位置不一致

**问题描述**：

- 多数测试文件与源文件同目录（`.spec.ts` 与 `.ts` 同位置）
- 部分模块测试文件放在 `test/` 目录下，部分放在 `src/` 下
- 没有统一的测试组织规范

**期望修复**：

- 统一测试文件位置：与源文件同目录，或统一放在 `test/unit/` 下
- 制定测试文件命名规范（`{name}.spec.ts` 或 `{name}.test.ts`）
- 明确测试 helper 的使用方式（`test/helpers/` 下的 `unit-helpers.ts` 和 `e2e-helpers.ts`）

---

### 4.5【警告】E2E 测试数据清理不彻底（来自 2026-06-28 审查）

**问题描述**：`afterAll` 清理了 `userIdentity`、`userSession`、`user`，但未清理可能存在的关联记录（如 `medicine-log`、`notification`）。

**状态**：🟡 未修复

**期望修复**：

```typescript
afterAll(async () => {
  await prisma.$transaction([
    prisma.userNotification.deleteMany(),
    prisma.medicineDoseLog.deleteMany(),
    prisma.userIdentity.deleteMany(),
    prisma.userSession.deleteMany(),
    prisma.user.deleteMany(),
  ]);
  await app.close();
});
```

---

### 4.6【警告】Mock 粒度过大，未验证调用参数（来自 2026-06-28 审查）

**问题描述**：对 `PrismaService` 整体 Mock，未验证 `where`、`data` 等参数的正确性。例如 `updateAccount` 将空字符串归一化为 `null`，Mock 若未校验传入的 `data` 对象，可能掩盖业务逻辑 bug。

**状态**：🟡 未修复

---

### 4.7【警告】单元测试未覆盖 Prisma 返回 null 场景（来自 2026-06-28 审查）

**问题描述**：虽然测试了 `NotFoundException`，但未覆盖 Prisma 方法返回 `null` 但业务逻辑错误地认为"存在"的场景。

**状态**：🟡 未修复

---

## 第五部分：其他安全问题

### 5.1【警告】eval/Function 使用（来自 2026-06-26 日常审查）

**问题描述**：`src/admin/adminjs.setup.ts:42` 使用了 `new Function(...)` 进行动态导入，存在安全风险。

**状态**：🔴 未修复（代码仍然存在）

**期望修复**：

- 评估是否可以替换为标准的 `import()` 动态导入
- 如果必须使用 `new Function`，添加安全注释说明原因

---

## 第六部分：docs 目录审查

### 6.1【警告】文档覆盖不均衡

**问题描述**：`docs/` 目录有部署文档和 API 契约，但缺少架构设计文档、模块依赖图、开发指南等。

**现有文档**：

- `README.md` — 目录说明（良好）
- `deployment.md` — 部署手册（良好）
- `environment.md` — 环境配置（良好）
- `openapi.json` — 生成的 API 契约（良好）
- `public/` — 5 个接口边界文档（一般）
- `TODO.md` — 仅 1675 字节，内容极简（可能不够完整）

**缺失文档**：

- 架构设计文档（模块依赖、数据流图）
- 开发指南（如何新增模块、目录规范）
- 数据库 Schema 说明（除 Prisma 外的人可读文档）
- 错误码对照表
- 测试编写指南

**期望修复**：

- 补充架构设计文档（可用 Mermaid 绘制模块依赖图）
- 扩充 `TODO.md` 或拆分为更详细的任务跟踪
- 新增 `CONTRIBUTING.md` 规范开发流程

---

## 第七部分：最严重问题 Top 10

| 排名 | 问题                               | 影响               | 涉及文件                                         |
| ---- | ---------------------------------- | ------------------ | ------------------------------------------------ |
| 1    | Apple OAuth 重复实现 JWT           | 安全隐患           | `auth/providers/apple-oauth.provider.ts`         |
| 2    | `files` 模块完全无测试             | 安全功能无测试覆盖 | `files/*.ts`                                     |
| 3    | 服务文件位置不统一                 | 目录混乱           | 11个模块                                         |
| 4    | Guard 目录滥用                     | 概念混淆           | 3个 guards/ownership.service.ts                  |
| 5    | 路由前缀不统一                     | API 设计混乱       | 全项目 Controller                                |
| 6    | 空 catch 吞掉异常                  | 隐蔽错误           | `medicines/medicines.service.ts`                 |
| 7    | 手动映射 Prisma 字段               | 维护负担           | `user-health-context/services/mapper.service.ts` |
| 8    | 文件上传缺少校验                   | 安全漏洞           | `files/files.service.ts`                         |
| 9    | ownership 服务重复实现             | 违反 DRY           | 3个 ownership.service.ts                         |
| 10   | `user-health-context` 测试严重不足 | 核心业务无测试     | `user-health-context/`                           |

---

## 第八部分：整体评估

| 维度           | 评分   | 说明                                                     |
| -------------- | ------ | -------------------------------------------------------- |
| 架构一致性     | ⭐⭐   | 存在多处"自行其是"的实现                                 |
| 目录结构一致性 | ⭐⭐   | 11个模块 vs 8个模块的服务目录差异                        |
| 安全与健壮性   | ⭐⭐   | 输入校验多处缺失，异常处理草率，eval/Function 未修复     |
| 代码复用       | ⭐⭐   | ownership 逻辑重复，AI 服务未抽取基类，未充分复用 helper |
| 可维护性       | ⭐⭐   | 目录混乱导致新开发者上手困难                             |
| NestJS 规范    | ⭐⭐⭐ | 基本遵循，但 guards/ 目录滥用                            |
| 测试覆盖       | ⭐⭐   | `files` 完全无测试，核心模块严重不足                     |
| 文档完整性     | ⭐⭐⭐ | 基本部署文档齐全，但缺少架构和开发指南                   |
| AI 服务复用    | ⭐⭐⭐ | Generator 和 Service 重复实现，未抽取基类                |

**总体评价**：功能完整，但工程化规范执行不严格，测试覆盖存在明显缺口（特别是 `files` 模块），AI 服务存在重复实现，需要一次"工程化整顿"。

**建议修复优先级**：

1. P0：修复安全问题（文件上传校验、JWT 实现、eval/Function）
2. P0：为 `files` 模块补充测试（最优先）
3. P1：统一目录结构（services/ 子目录）
4. P1：补充 `user-health-context` 和 `daily-records` 的测试
5. P1：抽取 AI Generator 和 Service 的基类（消除重复）
6. P2：统一路由前缀策略
7. P2：制定模块导出规范
8. P2：补充架构文档和开发指南
