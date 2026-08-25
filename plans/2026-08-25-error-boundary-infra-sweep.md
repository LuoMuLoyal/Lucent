# 错误处理基础设施层扫尾计划

Created: 2026-08-25
Status: active

> 前序计划：[`2026-08-18-error-contract-and-neverthrow-migration-plan.md`](2026-08-18-error-contract-and-neverthrow-migration-plan.md)
> 审查报告：[`Lucent-review-2026-08-24.md`](Lucent-review-2026-08-24.md)、[`Lucent-review-2026-08-25.md`](Lucent-review-2026-08-25.md)

## 背景

2026-08-18 的错误契约与 neverthrow 硬切计划阶段二第 5 步要求：

> 处理并测试所有裸 `throw error`、无日志 catch、默认空数组/null fallback；
> 每个保留的降级路径必须有 OTel event/metric、结构化日志和行为测试。

实际执行时，该步骤只覆盖了业务层（`src/modules/`），遗漏了基础设施层（`src/common/`）。
三轮审查（08-23、08-24、08-25）连续报告了同样的问题，始终未修复——根因是审查发现未进入
可追踪的 TODO 队列，每次审查都在重新发现同样的问题。

本计划只处理审查报告中确认的问题，不扩大范围。

## 问题清单

以下 8 项均经审查报告回查验证，代码现状与报告描述一致。

### P0-1：`RedisService.onModuleDestroy` 静默吞错

**文件：** `src/common/redis/redis.service.ts:79-81`

```typescript
async onModuleDestroy(): Promise<void> {
  await this.client?.quit().catch(() => undefined);
}
```

**问题：** `.catch(() => undefined)` 完全吞掉 Redis 断开错误，无任何日志记录。
属于硬切清单中"无日志、无契约说明的静默 catch"。

**修复：** 改为记录 warn 日志后放行（graceful shutdown 不应因 quit 失败而阻塞）。

```typescript
async onModuleDestroy(): Promise<void> {
  await this.client?.quit().catch((error: unknown) => {
    this.logger.warn(
      `Redis quit failed during shutdown: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}
```

**验收：** `quit()` 失败时输出 warn 日志；`quit()` 成功或 `client == null` 时无日志。

---

### P0-2：`AssistantToolService` 缓存操作无错误保护

**文件：** `src/modules/assistant/tools/tool.service.ts:250, 263`

```typescript
const cached = await this.cache.get<string>(cacheKey); // ← 无 try/catch
// ...
await this.cache.set(cacheKey, JSON.stringify(result), TOOL_CACHE_TTL_MS); // ← 无 try/catch
```

**问题：** Redis 故障直接中断对话流程，无法降级为无缓存执行。
仓库中其他所有缓存使用点（`SuggestionCacheService`、`MedicinesCacheService`、
`AuthRateLimitService`、`UserSettingsService`）均有 `cacheGet`/`cacheSet` 包装器，
此处是唯一遗漏。

**修复方向：** 缓存失败时降级为无缓存执行，而非崩溃。

```typescript
private async cacheGet(key: string): Promise<string | undefined> {
  try {
    return await this.cache.get<string>(key);
  } catch (error) {
    this.logger.warn(
      `Assistant tool cache get failed (key=${key}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined; // 降级：视为 cache miss
  }
}

private async cacheSet(key: string, value: string, ttl: number): Promise<void> {
  try {
    await this.cache.set(key, value, ttl);
  } catch (error) {
    this.logger.warn(
      `Assistant tool cache set failed (key=${key}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    // 降级：缓存写入失败不影响结果返回
  }
}
```

`executeOne` 中的调用改为 `this.cacheGet` / `this.cacheSet`。

**注意：** 此处降级策略与 `SuggestionCacheService`（catch 后 rethrow）不同。
`SuggestionCacheService` 的缓存是强一致读（miss 会触发重算），而 `AssistantToolService`
的缓存是纯加速（miss 直接走 `executeUncached`），所以降级为无缓存执行更合理。

**验收：** Redis 不可用时助手对话正常工作（无缓存），日志中有 warn 记录。

---

### P1-1：`domain-failure.ts` 裸 throw

**文件：** `src/common/result/domain-failure.ts:94`

```typescript
if (!isDomainFailure(candidate)) {
  throw new Error('Invalid DomainFailure input');
}
```

**问题：** 传入未注册的 code 时抛裸 `Error`，落到 `ApiExceptionFilter` 的
`handleUnknownError` 路径变成无差别 500。这是编程错误（调用方传入了非法参数），
按计划应走 throw 边界，但应保留结构化语义。

**修复：** 改为抛 `DomainFailureException`，携带 `INTERNAL_ERROR` DomainFailure。

```typescript
if (!isDomainFailure(candidate)) {
  throw new DomainFailureException(
    createDomainFailure({
      kind: 'internal',
      code: 'INTERNAL_ERROR',
      detail: 'Invalid DomainFailure input',
      cause: input,
    }),
  );
}
```

**注意循环依赖：** `createDomainFailure` 在自身内部引用自身会递归——如果
`input` 本身就是非法的，`createDomainFailure` 又会触发校验失败再调 `createDomainFailure`。
因此实际实现应直接构造字面量对象并手动校验 `_tag`，或改用静态 fallback：

```typescript
if (!isDomainFailure(candidate)) {
  throw new DomainFailureException({
    _tag: 'DomainFailure',
    kind: 'internal',
    code: 'INTERNAL_ERROR',
    detail: 'Invalid DomainFailure input',
  });
}
```

**验收：** 传入非法 code 时抛出 `DomainFailureException`，`ApiExceptionFilter`
映射为 500 Problem Details（`INTERNAL_ERROR`），而非裸 `Error` 的兜底路径。

---

### P1-2：`domain-failure.mapper.ts` 裸 throw

**文件：** `src/common/result/domain-failure.mapper.ts:16`

```typescript
if (!isDomainFailure(failure) || !options.catalog.isKnown(failure.code)) {
  throw new Error('Invalid or undocumented DomainFailure code');
}
```

**问题：** 与 P1-1 同类。新增错误码时如果忘记注册到 `ProblemCatalog`，
生产请求会变成无结构的 500。

**修复：** 与 P1-1 一致，改抛 `DomainFailureException`。

**验收：** 传入未注册 code 时抛出 `DomainFailureException`。

---

### P1-3：`RedisService.atomicIncrement` 裸 throw

**文件：** `src/common/redis/redis.service.ts:92-93`

```typescript
if (this.client == null) {
  throw new Error('Redis is not available');
}
```

**问题：** 基础设施不可用时抛裸 `Error`，调用方无法结构化处理。
应映射为 `DEPENDENCY_UNAVAILABLE`（503，可重试），而非无差别 500。

**修复：** 改抛 `DomainFailureException`。

```typescript
if (this.client == null) {
  throw new DomainFailureException(
    createDomainFailure({
      kind: 'dependency',
      code: 'DEPENDENCY_UNAVAILABLE',
      detail: 'Redis is not available',
      retryable: true,
    }),
  );
}
```

**调用方影响：** `AuthRateLimitService` 和 `VerificationCodeService` 调用
`atomicIncrement`。当前它们已有 try/catch 或 `lift` 包装，改为
`DomainFailureException` 后，`mapUnknownToDependencyFailure` 能正确识别
并映射为 `DEPENDENCY_UNAVAILABLE` 而非 `INTERNAL_ERROR`。

**验收：** Redis 不可用时抛出 `DomainFailureException`，filter 映射为 503。

---

### P1-4：`S3StorageRuntime.createSignedGetUrl` 裸 throw

**文件：** `src/common/storage/s3.runtime.ts:115-120`

```typescript
if (this.externalClient == null) {
  throw new Error(
    'STORAGE_S3_EXTERNAL_ENDPOINT is not configured. ' +
      'A public HTTPS endpoint is required to generate signed URLs ' +
      'for remote services (e.g. vision models).',
  );
}
```

**问题：** 配置缺失时抛裸 `Error`，调用方无法结构化处理。

**修复：** 改抛 `DomainFailureException`（`DEPENDENCY_UNAVAILABLE`，配置缺失
属于基础设施未就绪）。

```typescript
if (this.externalClient == null) {
  throw new DomainFailureException(
    createDomainFailure({
      kind: 'dependency',
      code: 'DEPENDENCY_UNAVAILABLE',
      detail:
        'STORAGE_S3_EXTERNAL_ENDPOINT is not configured; ' +
        'external audience signed URLs are unavailable.',
    }),
  );
}
```

**验收：** 配置缺失时抛出 `DomainFailureException`，filter 映射为 503。

---

### P2-1：`SuggestionCacheInvalidationListener` 失败仅 warn

**文件：** `src/modules/today-suggestion/services/cache/suggestion-cache-invalidation.listener.ts`
（6 个事件处理器）

**问题：** 缓存失效连续失败时用户持续读到 stale 数据，warn 级别不触发告警。

**修复方向：** 添加失败计数器，连续失败 N 次后升级为 error 级别。

```typescript
private consecutiveFailures = 0;
private static readonly ERROR_THRESHOLD = 3;

private handleCacheError(event: string, payload: { userId: string }, error: unknown): void {
  this.consecutiveFailures++;
  const logFn = this.consecutiveFailures >= SuggestionCacheInvalidationListener.ERROR_THRESHOLD
    ? this.logger.error.bind(this.logger)
    : this.logger.warn.bind(this.logger);
  logFn(`Failed to invalidate cache on ${event} (consecutive=${this.consecutiveFailures})`, {
    userId: payload.userId,
    error,
  });
}

// 成功时重置计数器
private onCacheSuccess(): void {
  this.consecutiveFailures = 0;
}
```

**验收：** 连续失败 3 次后日志升级为 error；成功后计数器重置。

---

### P2-2：`MedicinesCacheAdminService` 脆弱内省

**文件：** `src/modules/medicines/cache/admin.service.ts:34`

```typescript
const stores = this.cache.stores as KeyvLikeStore[] | undefined;
```

**问题：** 依赖 cache-manager 内部非公开 API，版本升级可能静默失效。

**修复方向：** 为内省逻辑添加运行时防御和 `cache-manager` 版本兼容性测试。
如果 `stores` 或 `store._cache.keys` 不可用，`listMedicineKeys` 返回空数组
并记录 warn 日志（当前已有 continue 逻辑，但无日志）。

**验收：** cache-manager 升级后管理后台不崩溃，降级为"无法列举"并记录日志。

---

## 执行顺序

1. **P0-1 + P0-2**（RedisService + AssistantToolService）—— 两个严重问题，
   连续三轮报告未修，优先解决。
2. **P1-1 ~ P1-4**（裸 throw 收口）—— 统一改为 `DomainFailureException`，
   一批改完。
3. **P2-1 + P2-2**（降级日志升级 + 内省防御）—— 可在 P1 之后迭代。

## 不做的事

- 不重构 `AssistantToolService.executeUncached` 的巨型 switch（审查报告
  "维护隐患"第 3 点，与本计划无关）。
- 不改 `LegalDocumentsService.writeCache` 的 best-effort 模式（审查判定为误判）。
- 不引入 `eslint-plugin-neverthrow`（原计划阶段二第 6 点，独立工作项）。
- 不改 `ApiExceptionFilter`——filter 的兜底逻辑正确，问题在上游抛出的异常类型。
