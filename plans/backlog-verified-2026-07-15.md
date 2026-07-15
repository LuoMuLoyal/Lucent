# 技术债务修补计划 — 2026-07-15

> 来源：7-13 全项目盘点 + 7-14 增量审查 + 7-15 代码级交叉验证
> 状态：待执行

---

## 一、Lucent 后端 — 5 项

### #3 排查嵌套事务风险 — P0

**代码验证结果**：6 个源文件使用 `$transaction`，当前无实际嵌套调用。结构性风险点在 `DailyRecordRepositoryPort.transaction()` 方法将 `$transaction` 能力泄漏到 service 层。

**具体改动**：

1. **`src/modules/daily-records/repositories/daily-record.repository.ts`**
   - `transaction()` 方法（行 172-176）添加 JSDoc 警告：
     ```typescript
     /**
      * Executes a Prisma transaction.
      *
      * WARNING: The callback MUST NOT call any method that internally uses `$transaction`.
      * Prisma nested transactions silently degrade to independent connections,
      * losing atomicity. If you need atomicity across repositories, move the
      * composite logic into a single repository method.
      */
     ```
   - 或者：移除 `transaction()` 方法，将需要原子性的复合操作封装为 repository 内部方法（与 `conversation.repository.ts` 的 `activateConversation` / `persistTurn` 模式一致）

2. **搜索 `repository.transaction(` 的所有调用方**，逐一确认 callback 内无嵌套 `$transaction` 调用

3. **在 `docs/01-reference/architecture.md`** 添加 Prisma 事务使用规范段落

**预估工时**：半天

---

### #2 提取 `safeParseLlmJson<T>()` — P1

**代码验证结果**：6 处重复的 "提取 JSON 子串 + parse + try-catch + 日志" 模式。

**具体改动**：

1. **新建 `src/common/helpers/safe-json.ts`**：

   ```typescript
   import { Logger } from '@nestjs/common';

   /**
    * Extracts a JSON object from LLM-generated text and parses it safely.
    *
    * Handles common LLM output patterns:
    * - Pure JSON
    * - JSON embedded in markdown code blocks
    * - JSON surrounded by explanatory text
    */
   export function safeParseLlmJson<T>(
     text: string,
     options?: {
       logger?: Logger;
       context?: string;
     },
   ): T | null {
     const jsonText = extractJsonObject(text);
     if (jsonText == null) {
       options?.logger?.warn(
         `No JSON object found in LLM response${options?.context ? ` (${options.context})` : ''}`,
       );
       return null;
     }

     try {
       return JSON.parse(jsonText) as T;
     } catch (error) {
       options?.logger?.warn(
         `Failed to parse LLM JSON${options?.context ? ` (${options.context})` : ''}: ${(error as Error).message}`,
       );
       return null;
     }
   }

   function extractJsonObject(text: string): string | null {
     const start = text.indexOf('{');
     const end = text.lastIndexOf('}');
     if (start >= 0 && end > start) {
       return text.slice(start, end + 1);
     }
     return null;
   }
   ```

2. **替换以下 6 个文件中的重复逻辑**：

   | 文件                                                                | 当前函数/方法                      | 改动                                                                                     |
   | ------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
   | `medicines/services/medicines.service.ts:65-78`                     | `recognizeMedicine` 内联 try-catch | 改为 `safeParseLlmJson(text, { logger: this.logger, context: 'medicine recognition' })`  |
   | `daily-records/services/meal-analysis/vision.service.ts:203-266`    | `parseRecognitionResponse`         | 改为 `safeParseLlmJson` + 保留后续字段校验逻辑                                           |
   | `daily-records/services/meal-dish/decomposition.service.ts:203-280` | `parseDecompositionResponse`       | 同上                                                                                     |
   | `assistant/tools/drugbank/entity-resolve.service.ts:155-180`        | `parseSearchPayload` 内 try-catch  | 改为 `safeParseLlmJson`                                                                  |
   | `assistant/tools/medicine/lookup.service.ts:396-418`                | `parseDetailPayload` 内 try-catch  | 同上                                                                                     |
   | `assistant/tools/vector-cursor.ts:27-32`                            | `decodeVectorCursor` 内 try-catch  | 保留独立实现（base64 解码 + parse 模式不同），或提取为 `safeParseJson`（不含 JSON 提取） |

3. **更新 `src/common/helpers/index.ts`** barrel export

4. **`daily-records/types/meal-analysis.types.ts:223`**：`JSON.parse(JSON.stringify(record))` 改为 `structuredClone(record)`

**预估工时**：半天

---

### #5 JSON.stringify 深比较处理 — P1

**代码验证结果**：全项目仅 1 处 `JSON.stringify(a) !== JSON.stringify(b)` 深比较。

**具体改动**：

**`src/modules/daily-records/types/meal-analysis.types.ts:293`**：

```typescript
// 当前
return JSON.stringify(nextMealInput) !== JSON.stringify(existingMealInput);

// 改为
return !deepEqual(nextMealInput, existingMealInput);
```

`deepEqual` 实现：在 `src/common/helpers/object-utils.ts` 中添加一个简单的深比较函数（不引入新依赖），或直接使用 Node.js 24 内置的 `util.isDeepStrictEqual`。

**预估工时**：10 分钟

---

### #1 五个模块补充审查 — P1

**审查范围（已确认）**：

| 模块              | 审查重点                                               | 文件数 |
| ----------------- | ------------------------------------------------------ | ------ |
| `auth/`           | OAuth 安全、session 管理、PIN 生命周期、JWT 签发与撤销 | ~25    |
| `assistant/`      | LLM 管道、工具执行链、会话持久化、proposal 安全        | ~30    |
| `reports/`        | PDF 生成、分享 token、诊所摘要数据隔离                 | ~15    |
| `medicines/`      | 药品搜索、识别、安全提示、双源数据隔离                 | ~15    |
| `today-analysis/` | 分析引擎、建议生成、通知创建、SSE 流式                 | ~20    |

**具体改动**：逐模块审查，每个模块产出审查报告。审查维度：

- 安全：IDOR、注入、越权
- 健壮性：错误处理、边界条件、超时
- 性能：N+1 查询、未索引扫描、大 payload
- 可维护性：类型安全、重复代码、死代码

**预估工时**：2-3 天（每模块半天）

---

### #6 `pnpm check` 持续监控 — P1

**具体改动**：在当前未提交改动提交前运行一次全量 `pnpm check`（lint + format + typecheck + build + test + e2e）。后续每次大改动后运行。

**预估工时**：半小时

---

## 二、Luminous 前端 — 3 项

### #9 用药安全后续 — P1

#### 9a. Allergy severity null-handling — 待修复

**当前状态**：`CreateHealthContextAllergyDto.severity` 是 `@IsOptional()`，`allergy-write.service.ts:28` 写入 `severity: dto.severity ?? null`。

**具体改动**：

1. 搜索所有消费 allergy 数据的服务（`today-analysis/services/recommendations.service.ts`、`reports/services/clinic-summary/summary.service.ts`）
2. 确认 `severity: null` 被视为"未知严重程度"而非"无过敏"
3. 如果消费方未处理 null，添加显式 null 检查和默认行为

**预估工时**：半天

#### 9b. CN medicine interaction gap — 已决策（ADR-0008）

**决策**：不维护 CN↔DrugBank 映射关系。`drugbankIds` 字段已删除。跨源查询由 LLM 自主通过工具链完成。

详见 [ADR-0008](docs/01-reference/adr/0008-no-cn-drugbank-medicine-mapping.md)。

#### 9c. Avoid-tier escalation policy — 待产品定义

**当前状态**：代码中无"avoid tier"概念。safety tips 是随机选取展示的。

**结论**：这是新功能，不是 bug 修复。暂缓，等产品定义"药品安全分级策略"后再实施。

#### 9d. Duplicate cross-language matching — 已决策（ADR-0008）

**决策**：CN 和 DrugBank 药品库不进行映射关系。搜索完全独立，通过 `source` 字段区分来源。跨源查询由 LLM 自主通过工具链完成。

详见 [ADR-0008](docs/01-reference/adr/0008-no-cn-drugbank-medicine-mapping.md)。

#### 9e. DrugBank synonym over-generalization — 待修复

**当前状态**：`DrugbankMedicinesService.buildWhere` 搜索条件包含 `searchText: { contains: q, mode: 'insensitive' }`，`searchText` 包含 synonyms，可能导致搜索"阿司匹林"时匹配到不相关药品。

**具体改动**：

1. 审查 `searchText` 的构建逻辑（在 `scripts/import/medicine/parsers/drugbank_drugs.py` 中），确认同义词的拼接方式
2. **选项 A（推荐）**：将 synonyms 从 `searchText` 中拆出，搜索 where 条件改为：
   ```typescript
   OR: [
     { name: { contains: q, mode: 'insensitive' } },
     { casNumber: { contains: q, mode: 'insensitive' } },
     { unii: { contains: q, mode: 'insensitive' } },
     { searchText: { contains: q, mode: 'insensitive' } }, // 不含 synonyms
     { synonyms: { array_contains: q, mode: 'insensitive' } }, // 单独搜索 synonyms
   ];
   ```
   注意：Prisma 的 `String[]` 列搜索语法需确认，可能需要 `has` 或 `hasSome`
3. **选项 B**：维持当前行为，在 `matchedBy` 字段中标识匹配来源（`name` / `casNumber` / `searchText`），前端展示匹配类型让用户判断

**预估工时**：半天

---

### #7 SemanticColor 暗色对比度验证 — P1

**当前状态**：`SemanticColorPalette` 定义 5 个色调（`solid`/`foreground`/`muted`/`subtle`/`border`），暗色模式 alpha 补偿已烘焙进颜色值。`subtle`（alpha 0.04~0.06）和 `border`（alpha 0.18~0.25）需实测。

**具体改动**：

1. 在真机/模拟器上切换暗色模式
2. 对每个 SemanticColor 的 `subtle` 和 `border` 色调做 WCAG 对比度检查（≥ 3:1 for large text, ≥ 4.5:1 for normal text）
3. 如果对比度不足，调整 `semantic_colors.dart` 中暗色模式的 alpha 值
4. 重点关注 `subtle`（大容器背景）和 `border`（强调容器边框）

**预估工时**：半天（需真机/模拟器）

---

### #8 Drift 缓存一致性 — P1

**当前状态**：6 张缓存表 + 1 张 pending_sync_queue。读取缓存优先（`cachedAt` + TTL），写入乐观写入，`SyncWorker` 网络恢复时重放队列。

**具体改动**：

1. **统一 TTL 常量**：审查各 DAO 的 TTL 值，在 `lib/core/database/` 下新建 `cache_constants.dart` 统一定义：

   ```dart
   abstract final class CacheTtl {
     static const dailyRecords = Duration(minutes: 5);
     static const todaySuggestions = Duration(minutes: 3);
     static const healthContext = Duration(minutes: 10);
     static const currentMedicines = Duration(minutes: 10);
     static const medicineDoseLogs = Duration(minutes: 5);
   }
   ```

2. **`SyncWorker` permanently failed UI 通知**：`lib/core/database/sync/sync_worker.dart` 中 `_replayEntry` 在 `retryCount + 1 >= maxRetry` 时标记为 permanently failed，但无 UI 提示。改为通过 Riverpod provider 暴露 failed count，在 Mine 页面展示同步失败提示

3. **多设备冲突策略文档化**：在 `Luminous/docs/00-current/Current_State.md` 添加"多设备数据同步策略"段落，明确 last-write-wins 行为

**预估工时**：1-2 天

---

## 三、已完成项

### ADR-0008: CN↔DrugBank 药品不进行映射关系 — 已完成

7-15 已完成以下改动：

| 文件                                                            | 改动                                        |
| --------------------------------------------------------------- | ------------------------------------------- |
| `docs/01-reference/adr/0008-no-cn-drugbank-medicine-mapping.md` | 新建 ADR                                    |
| `docs/01-reference/adr/README.md`                               | 添加索引                                    |
| `prisma/schema.prisma`                                          | 删除 `CnMedicineProduct.drugbankIds` 字段   |
| `src/modules/medicines/dto/medicine-detail.dto.ts`              | 删除 `CnMedicineDetailDto.drugbankIds` 字段 |
| `src/modules/medicines/adapters/cn.service.ts`                  | 删除 `parseDrugbankIds()` 方法 + 字段赋值   |
| `src/modules/medicines/adapters/cn.service.spec.ts`             | 删除 3 个 drugbankIds 测试用例 + mock 字段  |
| `scripts/import/medicine/parsers/cn_products.py`                | 删除 `drugbank_ids` 列解析                  |
| `scripts/import/medicine/import-medicine-knowledge.ts`          | 删除 2 处 `drugbank_ids` 列定义             |
| `docs/01-reference/contracts/data-sources-cn-products.md`       | 更新映射说明                                |
| `docs/00-current/Medicine_Data_RAG.md`                          | 更新映射说明                                |

> **注意**：schema 变更后需运行 `pnpm prisma migrate dev --name remove_cn_drugbank_ids` 生成迁移，并重新 `pnpm export:openapi` 更新 OpenAPI 规范。

---

## 四、执行顺序

| 批次 | 事项                                                | 预估工时 | 前置条件       |
| ---- | --------------------------------------------------- | -------- | -------------- |
| 0    | ADR-0008 字段删除后的迁移 + OpenAPI 重新导出        | 半小时   | 无（代码已改） |
| 1    | #3 嵌套事务排查 + 修复                              | 半天     | 无             |
| 2    | #2 提取 `safeParseLlmJson` + `structuredClone` 替换 | 半天     | 无             |
| 3    | #5 深比较处理                                       | 10 分钟  | 无             |
| 4    | #6 `pnpm check` 全量验证                            | 半小时   | 1-3 完成后     |
| 5    | #9a allergy severity null-handling                  | 半天     | 无             |
| 6    | #9e DrugBank synonym 搜索优化                       | 半天     | 无             |
| 7    | #1 五模块审查                                       | 2-3 天   | 无             |
| 8    | #7 SemanticColor 暗色验证                           | 半天     | 需真机/模拟器  |
| 9    | #8 Drift 缓存一致性                                 | 1-2 天   | 无             |

**总计预估**：5-7 个工作日

---

## 五、暂缓项

以下项目暂缓执行，后续根据产品节奏重新排期：

- 产品体验：Today 信息密度收窄、Record 快速入口动态排序、Mine 档案完整度提示
- 法律合规：未成年人保护、SDK 清单、权限说明、注销政策
- 发布验证：`dart run tool/run_daily_checks.dart`、集成测试框架选型
- #9c Avoid-tier escalation policy — 待产品定义药品安全分级策略

---

## 六、关联计划

- `plans/express-to-fastify-migration.md` — Express → Fastify 迁移（独立计划，预估 8-10 人天，待启动）

---

_验证方法：grep/rg 搜索 + 源码逐文件审查 + 文档（TODO.md / Next_Plan.md / Current_State.md）交叉核对。_
