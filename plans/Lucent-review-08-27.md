# Lucent 每日代码审查 · 2026-08-27

- 审阅日期：2026-08-27（上海时区）
- 提交区间：UTC 2026-08-26 16:00:00 ~ UTC 2026-08-27 15:59:59（= 上海 2026-08-27 00:00:00 +0800 ~ 2026-08-27 23:59:59 +0800）
- 最早 commit: `0f09e4e` (fix(account): 事务内 hasPassword Err 不再静默吞掉)
- 最晚 commit: `7eb6b0a` (fix(medicine-dose-logs): 临时打卡不再强制要求 scheduledTime)
- commit 数: 10
- 审阅范围: 31 个文件，+402 / -89

## TL;DR

本次提交以"修复昨日（08-26）审查报告中的问题"为主线，整体质量较高：每一项 C/W/S 都对应了具体 commit、测试与文档迁移日志；无新增重复造轮子、无静默失败、无裸 `throw new Error()`、无直接 `process.env` 调用、无 TODO/FIXME 遗留。但仍有 **3 处建议** 需后续打磨。

10 个 commit 串成一条清晰的"审查反馈 → 修复"链：

```
0f09e4e C-1: account tx hasPassword Err
e690b43 C-2: eslint calleeToText 中段可选链
bcfee65 W-1: VictoriaLogs console.error → 注入 Logger
06a0568 W-2: DomainFailure invariant error 附带入参 JSON
0ec0d74 W-3: parsePayload logger 必填 (1/2)
d7b3a2e W-4: isBetterAuthTrustedProvider helper
fb40a20 W-5: toThrow → toMatchObject 结构化断言
d323a6b S-1: decodeVectorCursor logger 必填
62d496e fix: DrugBank 列表字段可选
7eb6b0a fix: dose-logs mark 临时打卡放行
```

## Critical

无新增 critical 级问题。所有昨日 critical 项（C-1、C-2）已正确修复并附新测试。

## Warning

无新增 warning 级问题。昨日所有 warning 项（W-1 ~ W-5）已修复。

## Suggestion

### S-1 · 测试用例 `eslint-plugins/error-handling.spec.ts` 通过硬编码 pnpm 路径加载 acorn

- 严重程度: suggestion
- 文件: `eslint-plugins/error-handling.spec.ts:5-7`
- 现状:
  ```ts
  const acorn =
    require('../node_modules/.pnpm/acorn@8.18.0/node_modules/acorn') as typeof import('acorn');
  ```
- 风险: 路径中嵌入了具体版本号 `8.18.0` 与 pnpm 哈希目录。`pnpm install` 一旦重新生成哈希或升级 acorn 测试就会因 `MODULE_NOT_FOUND` 失败。
- 推荐修正: 把 `acorn` 显式声明为 devDependency，然后直接 import：
  ```ts
  // package.json devDependencies:  "acorn": "^8.0.0"
  import { parse as acornParse } from 'acorn';
  ```
  或退一步用 `createRequire` 走包名解析（不带路径）：
  ```ts
  const { parse } = require('acorn') as typeof import('acorn');
  ```

### S-2 · 新 vitest config `vitest.eslint-plugins.config.ts` 未注册到 `package.json` script

- 严重程度: suggestion
- 文件: `vitest.eslint-plugins.config.ts`（新增） + `package.json:31-39`
- 现状: 新增了独立 vitest 配置（`include: ['eslint-plugins/**/*.spec.ts']`），但 `package.json` 现有 scripts 中没有 `test:eslint-plugins` 这类条目。开发者要跑这组测试得手动 `pnpm vitest run --config ./vitest.eslint-plugins.config.ts`，与 `test:tools` / `test:e2e` 的发现体验不一致。
- 推荐修正: 在 `package.json` scripts 块新增：
  ```json
  "test:eslint-plugins": "cross-env NODE_ENV=test vitest run --config ./vitest.eslint-plugins.config.ts",
  ```
  并考虑把 `test` 主入口改为依次跑多份 config（避免静默漏跑 eslint-plugins 测试）。

### S-3 · `logger.module.ts` 在 factory 中 `new Logger(...)` 而非走 DI

- 严重程度: suggestion
- 文件: `src/common/logger/logger.module.ts:26-27`
- 现状:
  ```ts
  const victoriaLogger = new Logger('VictoriaLogsTransport');
  ```
  紧接着作为 closure 传给 `fallbackLogger`。
- 评价: 行为正确、context 名清晰，且不依赖 DI 容器生命周期，是可接受的写法。但与项目里大多数 service 都通过 `private readonly logger = new Logger(...)`（类字段）或 `@InjectLogger()` 注入的风格略有不同；如果未来要切换到 pino/pino-http，hook 点会比较分散。
- 推荐修正（可选）: 抽一个 `LoggerModule` 内的 `class VictoriaLogsTransportFactory` 用 `inject(Logger)` 显式注入；或保持现状不变。优先级低。

## 逐文件走查

### `src/modules/account/services/account.service.ts`

C-1 修复正确。`hasPassword` 在事务内从 `r.isOk()` 改为显式 `isErr()` + `throw new DomainFailureException(...)`，能让 Prisma 抖动被事务回滚而不是错误降级为"无密码"触发 `FORBIDDEN`。

```ts
const txHasPasswordResult = await this.betterAuthAdapter.hasPassword(
  userId,
  tx,
);
if (txHasPasswordResult.isErr()) {
  throw new DomainFailureException(txHasPasswordResult.error);
}
const txHasPassword = txHasPasswordResult.value;
```

新测试 `account.service.spec.ts:553` 用 `mockReturnValueOnce` 区分了"事务前 pre-check"和"事务内 re-check"，并断言 `prisma.account.deleteMany` 未被调用（证明 rollback 生效）。逻辑闭环。

### `eslint-plugins/error-handling.ts` + `error-handling.spec.ts` + `vitest.eslint-plugins.config.ts`

C-2 修复。`calleeToText` 入口统一 `unwrapChain`，`MemberExpression` 分支递归处理 `callee.object` 为 `ChainExpression` 的情况。覆盖了：

- `foo()`
- `logger.warn()`
- `this.logger.warn()`
- `logger?.warn()`
- `this?.logger?.warn()`
- `obj?.foo.bar()`（中段可选链）
- `service?.logger.warn()`
- `console.warn()`

新增 9 个 fixture 测试 + 1 个 negative case。

注意见 S-1：acorn 路径硬编码；S-2：vitest config 未注册。

### `src/common/logger/logger.config.ts` + `logger.module.ts`

W-1 修复。`LoggerOptionsInput` 新增可选 `fallbackLogger`，factory 注入 `new Logger('VictoriaLogsTransport')`，transport `on('warn')` 走注入 logger。无注入时回退到 `console.error`（用于早期 bootstrap 与单测）。

ADR-0012（no silent failures / no `console.*` in app code）执行彻底：原 `console.error(...)` 已被完全替代，仅保留 fallback 兜底。

### `src/common/result/domain-failure.ts` + `domain-failure.mapper.ts` + `domain-failure.mapper.spec.ts`

W-2 修复。两处 `throw new Error('xxx')` 改为附 `JSON.stringify(input)`，方便事后排错。同时 spec 的 `toThrow()` 加严为 `toThrow('NOT_IN_CATALOG')`。`eslint-disable-next-line error-handling/no-bare-throw-error` 注释保留，理由（invariant violation in pure helper）合理。

### `src/modules/assistant/tools/drugbank/entity-resolve.service.ts` + `search.service.ts` + `search.service.spec.ts` + `medicine/lookup.service.ts` + `leaflet/read.service.ts` + `read.service.spec.ts` + `knowledge/medical.service.ts`

W-3 修复 + S-1（decodeVectorCursor 配套）。`parseSearchPayload` / `parseLookupPayload` 的 `logger?` → `logger`（必填），移除 `eslint-disable` 注释，调用点 `logger?.warn` → `logger.warn`。所有测试同步传入 mock logger。type-only import 用 `import { Logger } from '@nestjs/common'`（值导入用，因为运行时确实引用了 `Logger` 的类型面）。

### `src/modules/auth/adapters/better-auth.adapter.ts` + `index.ts` + `services/oauth/oauth.service.ts`

W-4 修复。`isBetterAuthTrustedProvider(provider: string): boolean` 抽出，封装 `readonly` → `string[]` cast。`src/modules/auth/index.ts` 同步 export，调用点 `oauth.service.ts` 改为 helper 调用。DRY 干净。

### `src/modules/assistant/tools/vector/vector-cursor.ts` + `vector-cursor.spec.ts`

S-1 修复。模块级 `new Logger('VectorCursor')` 移除，`decodeVectorCursor` 新增必填 `logger: Logger` 参数。所有调用方（3 个 service + 9 处 test）已更新。模块级 mutable state 减一。

### `src/common/storage/s3.runtime.spec.ts` + `data-export/services/queue.service.spec.ts` + `reports/services/event-review/review.service.spec.ts`

W-5 修复。3 处 `.rejects.toThrow(...)` 改为 `.rejects.toMatchObject({ failure: { code, detail } })`。断言更有意义：不仅看错误码还看 detail 内容，回归测试捕获力提升。

### `src/modules/medicine-dose-logs/services/dose-logs.service.ts` + `dose-logs.service.spec.ts`

临时打卡修复。`buildMarkLookupWhere` 在 `reminderId == null` 时返回 `null`，旧校验 `where == null && (... || scheduledTime == null)` 会把合法的"只有 `currentMedicineId`"的临时打卡拒掉。改为 `where == null && currentMedicineId == null`：

- `where == null` ⇒ 无 reminder（必为临时打卡）
- 只需 `currentMedicineId` 存在
- `scheduledTime` 现在可选

Spec 同步更新：原 reject 用例改为"create mark when currentMedicineId is provided without scheduledTime (temporary log)"，断言 `repository.create` 被调用且 `scheduledTime: null`。

注意：行为变化对外部契约的"提醒打卡"路径无影响（reminder 路径走 `where != null` 分支），但需要前端 / 客户端确认 SyncWorker 重放逻辑在 08-27 下午的 hotfix 后已收敛。migration log 已记录此修复（"SyncWorker 重放 dose log mark 请求 VALIDATION_FAILED 修复"）。

### `src/modules/medicines/dto/detail.dto.ts` + `docs/openapi.json`

DrugBank 列表字段修复。`groups` / `categories` / `atcCodes` / `synonyms` / `foodInteractions` 从 `@ApiProperty` 改为 `@ApiPropertyOptional({ nullable: true })`，类型从 `string[]` → `string[] | null`。OpenAPI `required` 数组从 6 个字段简化为 `["kind"]`。

根因记在 migration log：生成的 Dart DTO 用 `checked: true` 反序列化，CN 药品详情缺字段时抛 `CheckedFromJsonException`，再被 `DioException(unknown)` + 错误的 `Content-Type` 解析链路吞掉。修复后类型对齐，前端 mapper 同步 `?? const []`。

### `docs/01-reference/contracts/reminder-contract.md` + `docs/02-logs/migration-log/2026-08-27.md`

契约文档 + 迁移日志同步。无问题。`reminder-contract.md` 的 "Boundary / Status" 段落新增 "Dose-log mark (temporary logging)" 项，与代码行为一致。`2026-08-27.md` 详尽记录了 C-1/C-2/W-1..W-5/S-1 六类问题的修复映射 + 两个 hotfix（SyncWorker + DrugBank）的根因溯源，对未来回溯非常友好。

## 全局扫描

- 重复造轮子: 无。helper 化（`isBetterAuthTrustedProvider`）是减熵，加熵点是测试 fixture 复用（合理）。
- 严重 bug: 无。
- TODO / FIXME / 未完成任务: 无新增。
- 静默失败 / 无日志 / 空 catch / 裸 throw: 无新增。两处裸 `throw new Error(...)` 是不可恢复的 invariant 违反，且有 `eslint-disable` 注释说明，附 `JSON.stringify(input)`，符合规范。
- 直接调用 `process.env` 而非 `ConfigService`: 本次 diff 内 0 处。
- 错误处理不符合 NestJS 已有规范: 无。C-1 的 `DomainFailureException` 抛出 + 事务 rollback 链路是标准模式。
- 类型安全: `decodeVectorCursor` 改为必填后所有调用点已同步更新；`isBetterAuthTrustedProvider` helper 替代了内联 cast。
- 文档同步: `reminder-contract.md` / `migration-log/2026-08-27.md` / `openapi.json` 三处都已对齐。

## 建议的后续动作

1. (S-1) 把 acorn 提到 devDependency + 改 import 路径。
2. (S-2) 在 `package.json` 注册 `test:eslint-plugins` script，并考虑加入 `test` 主入口聚合。
3. (S-3) 评估是否需要把 `new Logger('VictoriaLogsTransport')` 抽成 provider（低优先级，保持现状亦可）。

整体评价：**非常扎实的一次"审查反馈 → 修复"提交**，修复覆盖完整、测试闭环、文档迁移同步及时。仅余 3 处低优先级的工程化建议。
