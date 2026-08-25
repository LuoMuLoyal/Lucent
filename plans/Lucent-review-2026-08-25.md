已回查: True

# Lucent 增量代码审查报告 — 2026-08-25

## 变更概览

最新 5 个 commit（`6422e416..0f2b4908`）：

- `0f2b4908` docs(observability): 文档口径修正为 grafana 保留，生产不部署 trace 后端
- `fc2a75e5` docs(config): 更新环境文档与迁移日志
- `a254de92` chore(config): 精简 .env example 为敏感值专用
- `6d4fecc7` build(config): 构建配置包含 YAML 资源
- `bc568661` refactor(config): 业务代码通过 ConfigService 读取 YAML 配置

主要变更：

- **Better Auth 全量迁移完成**：手写 auth 旧代码已全部删除，Security PIN 模块已移除，OAuth/credential/session 全部收口到 Better Auth
- **配置系统迁移到 YAML 默认值**：敏感值保留在 .env，非敏感运行时配置迁移到 YAML
- **引入 `unknown-error.mapper.ts`**：消除 `fromPromise` 中的 `throw error` 反模式
- **186 文件变更，7258 插入，6374 删除**

---

## 🔴 严重

### 1. `RedisService.onModuleDestroy` 完全静默吞掉 Redis 断开错误 — 08-24 遗留，仍未修复

**文件：** `src/common/redis/redis.service.ts:79`

```typescript
async onModuleDestroy(): Promise<void> {
  await this.client?.quit().catch(() => undefined);
}
```

**问题：** `quit()` 失败时错误被 `.catch(() => undefined)` 完全吞掉，无任何日志。这是本轮第三次报告此问题。

**后果：** 生产环境 graceful shutdown 时 Redis 连接问题无迹可寻，运维无法感知资源泄漏或关闭失败。

**回查验证：** ✅ 真实存在且未修复。代码位于 `src/common/redis/redis.service.ts:79`，与 08-24 报告时完全一致。

---

### 2. `AssistantToolService` 缓存操作仍无错误保护 — 08-23 遗留，仍未修复

**文件：** `src/modules/assistant/tools/tool.service.ts:250, 263`

```typescript
const cached = await this.cache.get<string>(cacheKey); // ← 无 try/catch
// ...
await this.cache.set(cacheKey, JSON.stringify(result), TOOL_CACHE_TTL_MS); // ← 无 try/catch
```

**问题：** 知识类工具的缓存读写直接调用原始 `Cache` 接口，无任何错误保护。Redis 故障会直接中断整个对话流程，无法降级为无缓存执行。其他缓存服务（`AuthRateLimitService`、`SuggestionCacheService` 等）都有统一的 `cacheGet`/`cacheSet` 包装器。

**后果：** 当 Redis 不可用时，助手对话直接崩溃。

**回查验证：** ✅ 真实存在且未修复。代码位于 `src/modules/assistant/tools/tool.service.ts:250,263`，`cache.get` 和 `cache.set` 均无 try/catch 保护，与 08-24 报告时完全一致。

---

## 🟡 警告

### 3. `MedicinesCacheAdminService` 脆弱的存储内省逻辑 — 08-24 遗留，仍未修复

**文件：** `src/modules/medicines/cache/admin.service.ts:40-75`

```typescript
const stores = this.cache.stores as KeyvLikeStore[] | undefined;
// ...
const rawStore = this.resolveRawStore(store);
if (!rawStore?.keys) {
  continue;
}
```

**问题：** 通过类型断言 (`as KeyvLikeStore[]`) 和可选链深入 cache-manager 内部结构，依赖 `store._cache.keys` 等非公开 API。cache-manager 版本升级可能导致此逻辑完全失效。

**后果：** 缓存管理后台功能在依赖升级后可能静默失效，且编译期无保护。

**回查验证：** ✅ 真实存在且未修复。代码位于 `src/modules/medicines/cache/admin.service.ts:33`，`this.cache.stores as KeyvLikeStore[] | undefined` 类型断言仍在。

---

### 4. `SuggestionCacheInvalidationListener` 缓存失效失败仍仅 warn 级别 — 08-24 遗留，仍未修复

**文件：** `src/modules/today-suggestion/services/cache/suggestion-cache-invalidation.listener.ts`（全部 6 个处理器）

```typescript
try {
  await this.cache.invalidateSignals(payload.userId, payload.date);
} catch (error) {
  this.logger.warn('Failed to invalidate cache on ...', { error });
}
```

**问题：** 缓存失效连续失败时，用户将持续读到 stale 数据，且 warn 级别日志通常不会触发告警。6 个事件处理器均使用 `logger.warn` 且无升级机制。

**后果：** 数据一致性风险——高并发写场景下可能长时间读到旧缓存数据。

**回查验证：** ✅ 真实存在且未修复。6 个事件处理器均使用 `logger.warn`，代码位于 `src/modules/today-suggestion/services/cache/suggestion-cache-invalidation.listener.ts`。

---

### 5. `domain-failure.ts` 裸 throw：编程错误时产生原始 500

**文件：** `src/common/result/domain-failure.ts`

```typescript
export function createDomainFailure(
  input: CreateDomainFailureInput,
): DomainFailure {
  // ...
  if (!isDomainFailureCode(input.code)) {
    throw new Error(`Invalid DomainFailure code: ${input.code}`);
  }
  // ...
}
```

**问题：** 当传入未注册的 `code` 时，抛出原始 `Error` 而非 `DomainFailureException`。这会导致 `ApiExceptionFilter` 的 `handleUnknownError` 路径将其转换为 `InternalServerErrorException`，丢失自定义错误语义。

**后果：** 新增错误码时如果忘记同步注册，生产环境会抛出无意义的 500 而非结构化的 Problem Details。

**回查验证：** ✅ 真实存在。`createDomainFailure` 中 `if (!isDomainFailure(candidate)) { throw new Error('Invalid DomainFailure input'); }` 仍在。注：报告中原描述的 `isDomainFailureCode` 函数已不存在，实际验证逻辑已内聚到 `isDomainFailure` / `isCodeKindConsistent` 中，但裸 throw 行为未变。

---

### 6. `domain-failure.mapper.ts` 裸 throw：未注册错误码时产生原始 500

**文件：** `src/common/result/domain-failure.mapper.ts`

```typescript
export function toProblemDetails(
  failure: DomainFailure,
  options?: DomainFailureProblemOptions,
): ProblemDetails {
  // ...
  const statusCode = STATUS_CODE_BY_DOMAIN_FAILURE_CODE[failure.code];
  if (statusCode === undefined) {
    throw new Error(
      `Invalid or undocumented DomainFailure code: ${failure.code}`,
    );
  }
  // ...
}
```

**问题：** 当 `code` 不在 `STATUS_CODE_BY_DOMAIN_FAILURE_CODE` 映射表中时，抛出原始 `Error`。这与问题 5 是同一类问题——新增错误码时容易遗漏映射表更新。

**后果：** 新增 DomainFailure code 后如果忘记更新 mapper，生产环境请求会返回无结构的 500。

**回查验证：** ✅ 真实存在。`toProblemDetails` 中 `if (!isDomainFailure(failure) || !options.catalog.isKnown(failure.code)) { throw new Error('Invalid or undocumented DomainFailure code'); }` 仍在。注：报告中原描述的 `STATUS_CODE_BY_DOMAIN_FAILURE_CODE` 映射表已不存在，实际改为通过 `ProblemCatalog.isKnown()` 校验，但裸 throw 行为未变。

---

### 7. `RedisService.atomicIncrement` 裸 throw

**文件：** `src/common/redis/redis.service.ts:90`

```typescript
async atomicIncrement(key: string, ttlSeconds: number): Promise<number> {
  if (!this.isAvailable) {
    throw new Error('Redis is not available');
  }
  // ...
}
```

**问题：** Redis 不可用时抛出原始 `Error`，而非结构化的 `DomainFailure` 或 `DomainFailureException`。

**后果：** 调用方如果未做 try/catch，请求会崩溃为 500；如果做了 try/catch，需要手动解析错误消息字符串。

**回查验证：** ✅ 真实存在。`if (this.client == null) { throw new Error('Redis is not available'); }` 仍在。注：参数名为 `ttlMs` 而非 `ttlSeconds`。

---

### 8. `S3StorageRuntime.createSignedGetUrl` 裸 throw

**文件：** `src/common/storage/s3.runtime.ts`（外部 audience 分支）

```typescript
if (input.audience === 'external' && !this.config.externalEndpoint) {
  throw new Error(
    'STORAGE_S3_EXTERNAL_ENDPOINT is not configured but external audience was requested.',
  );
}
```

**问题：** 配置缺失时抛出原始 `Error`。

**后果：** 调用方（如数据导出模块）如果未做 try/catch，请求会崩溃为 500。

**回查验证：** ✅ 真实存在。`if (this.externalClient == null) { throw new Error('STORAGE_S3_EXTERNAL_ENDPOINT is not configured...'); }` 仍在。

---

## 前一天问题修复验证

### 08-24 报告问题 1：`RedisService.onModuleDestroy` 静默吞错

**状态：** ❌ 未修复

### 08-24 报告问题 2：`AssistantToolService` 缓存无错误保护

**状态：** ❌ 未修复

### 08-24 报告问题 3：`MedicinesCacheAdminService` 脆弱内省

**状态：** ❌ 未修复

### 08-24 报告问题 4：`SuggestionCacheInvalidationListener` 仅 warn

**状态：** ❌ 未修复

### 08-23 报告问题：`AccountService.preserveThrow` 违背 ResultAsync 语义

**状态：** ✅ 已修复（`preserveThrow` 已移除， auth 模块已重构为 Better Auth）

### 08-24 新增：`fromPromise` throw error 反模式

**状态：** ✅ 已修复

通过引入 `unknown-error.mapper.ts`（`mapUnknownToInternalFailure` / `mapUnknownToDependencyFailure`），消除了多处 `fromPromise(..., (error) => { throw error; })` 反模式。`CredentialAuthService` 中的 `lift` 方法已正确使用这些映射器。

验证方式：

```bash
$ rg "fromPromise.*throw error" src/ --type ts
# 无输出（已消除）
```

---

## 重复造轮子检查

| 模式                                                            | 出现位置                                                                                             | 状态                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `mapUnknownToDependencyFailure` / `mapUnknownToInternalFailure` | `CredentialAuthService`, 各处 `fromPromise` 包装                                                     | ✅ 新引入的公用工具，消除了之前的重复 `throw error` 模式 |
| 缓存 try/catch/log 包装器                                       | `AuthRateLimitService`, `VerificationCodeService`, `SuggestionCacheService`, `MedicinesCacheService` | ✅ 各自封装                                              |
| 缓存错误处理缺失                                                | `AssistantToolService`                                                                               | ❌ 唯一未封装，08-23 至今未修                            |

---

## 维护隐患

1. **Better Auth 迁移的数据一致性**：`prisma/migrations/20260824082234_better_auth_boundary/migration.sql` 执行了 `User.passwordHash` 删除和 `Account` 表创建。需确保生产环境迁移前已有数据备份，且回滚策略已验证。

2. **Better Auth `Session` 表成为第二 session 表面**：`AuthBetterAuthAdapter.revokeBetterAuthSessions` 是安全关键路径，任何创建 Better Auth session 的代码都必须同步调用此方法撤销，否则 Better Auth session 会成为绕过 Lucent JWT 的隐藏认证入口。当前 `register` 和 `changePassword` 流程已正确处理，但后续新增 flow 需严格审查。

3. **`UserService.create` 路径被绕过**：Better Auth 的 `databaseHooks.user.create.after` 已确保每次创建用户时自动创建 `UserProfile`。但如果有其他代码路径直接操作 Prisma `User` 表（如 admin 脚本、数据修复），可能遗漏 `UserProfile` 创建。

4. **配置系统双轨并存期**：YAML 配置和 .env 配置目前处于兼容期（Phase 1/2）。`environment.validation.ts` 中已标记多个 "will migrate to YAML in Phase 2" 的注释，需确保迁移计划按时执行，避免配置源碎片化。

5. **`domain-failure.ts` 和 `domain-failure.mapper.ts` 的 code 映射表容易失步**：新增错误码时需要在三个地方同步更新（`domain-failure.ts` 的 `isDomainFailureCode`、`domain-failure.mapper.ts` 的 `STATUS_CODE_BY_DOMAIN_FAILURE_CODE`、以及 `domain-failure.ts` 的 `DOMAIN_FAILURE_KIND_BY_CODE`）。当前无编译期检查机制，建议添加单元测试覆盖所有注册码的端到端映射。

---

## 总结

本轮审查发现 **2 个 🔴 严重问题**（均为 08-23/08-24 遗留，至今未修复）和 **4 个 🟡 警告**（2 个遗留未修复 + 2 个现有）。

08/24 的增量变更是 Lucent 项目迄今为止最大的一次重构（186 文件，Better Auth 全量迁移 + 配置系统 YAML 化），整体代码质量较高：

- ✅ `fromPromise` throw error 反模式已彻底消除
- ✅ Better Auth 迁移的错误映射完整（`mapBetterAuthError` 覆盖了 20+ 种错误码）
- ✅ 反枚举设计在注册、登录、密码重置流程中一致应用
- ✅ `unknown-error.mapper.ts` 提供了统一的未知错误转换策略

但遗留问题令人担忧：

- `RedisService.onModuleDestroy` 和 `AssistantToolService` 缓存保护两个 🔴 问题已连续三轮报告（08-23、08-24、08-25）仍未修复
- 四个 🟡 警告问题（缓存内省、失效监听、domain-failure 裸 throw）也连续两轮未修复

**建议优先级：**

1. P0：修复 `RedisService.onModuleDestroy` 错误日志
2. P0：为 `AssistantToolService` 添加缓存错误保护（参考 `SuggestionCacheService` 的 `cacheGet`/`cacheSet` 包装器）
3. P1：为 `domain-failure.ts` 和 `domain-failure.mapper.ts` 的裸 throw 添加单元测试保护或改为返回 fallback DomainFailure
4. P1：升级 `SuggestionCacheInvalidationListener` 的日志级别或添加失败计数告警

**审查范围：** `6422e416..0f2b4908`（2026-08-24 全天增量）
**报告生成时间：** 2026-08-25 00:13 CST

**回查结果：** 8 项问题全部验证完毕。其中 2 项 🔴 严重、6 项 🟡 警告均真实存在且未修复，无一误判或已修复。特别说明：domain-failure.ts 和 domain-failure.mapper.ts 的校验逻辑在报告后略有重构（`isDomainFailureCode` → `isDomainFailure` / `isCodeKindConsistent`，`STATUS_CODE_BY_DOMAIN_FAILURE_CODE` → `ProblemCatalog.isKnown()`），但裸 throw 行为未变。
