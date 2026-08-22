# DomainFailure + ResultAsync Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Lucent's project-owned `neverthrow` Result seam, typed `DomainFailure`, and one mapper to the existing Problem Details catalog without migrating any business domain.

**Architecture:** Add exact `neverthrow` version `8.2.0`, re-export the minimal Result surface from `src/common/result/index.ts`, and keep domain failures independent of HTTP status and localized text. A pure mapper validates the failure code and delegates status, URI, and i18n to `ProblemCatalog`; existing repositories, services, controllers, and filters remain unchanged.

**Tech Stack:** NestJS 11, TypeScript, `neverthrow` 8.2.0, Vitest, `nestjs-i18n`, pnpm.

---

## Task 1: Pin the neverthrow dependency

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add the exact runtime dependency.**

Run from `Lucent/`:

```powershell
pnpm add neverthrow@8.2.0 --save-exact
```

Expected: `package.json` contains exactly `"neverthrow": "8.2.0"` under `dependencies`, and the lockfile resolves `neverthrow@8.2.0`.

- [ ] **Step 2: Verify the dependency is installed without changing application code.**

Run:

```powershell
pnpm exec node -e "const n = require('neverthrow'); if (!n.ResultAsync || !n.okAsync || !n.errAsync) process.exit(1); console.log('neverthrow 8.2.0 exports verified')"
```

Expected: the command exits 0 and prints `neverthrow 8.2.0 exports verified`.

- [ ] **Step 3: Commit the dependency only.**

```powershell
git add package.json pnpm-lock.yaml
git commit -m "build(error): 固定 neverthrow 依赖"
```

## Task 2: Create the project-owned Result entry point

**Files:**

- Create: `src/common/result/index.ts`
- Test: `src/common/result/index.spec.ts`
- Append: `docs/02-logs/migration-log/2026-08-22.md`

- [ ] **Step 1: Write the failing entry-point test.**

Create `src/common/result/index.spec.ts`:

```ts
import { errAsync, ok, okAsync, Result, ResultAsync } from '.';

describe('common/result entry point', () => {
  it('exposes synchronous Result constructors', () => {
    const result: Result<number, string> = ok(1);

    expect(result.isOk()).toBe(true);
    expect(result.unwrapOr(0)).toBe(1);
  });

  it('exposes asynchronous Result constructors', async () => {
    const success: ResultAsync<number, string> = okAsync(1);
    const failure: ResultAsync<number, string> = errAsync('failed');

    await expect(
      success.match(
        (value) => value,
        () => 0,
      ),
    ).resolves.toBe(1);
    await expect(
      failure.match(
        () => 0,
        (error) => error,
      ),
    ).resolves.toBe('failed');
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the entry point is missing.**

Run:

```powershell
pnpm vitest run src/common/result/index.spec.ts
```

Expected: FAIL because `src/common/result/index.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal explicit entry point.**

Create `src/common/result/index.ts`:

```ts
export {
  err,
  errAsync,
  fromPromise,
  ok,
  okAsync,
  Result,
  ResultAsync,
} from 'neverthrow';
```

Do not add a wrapper class, NestJS integration, Result interceptor, or wildcard export.

- [ ] **Step 4: Run the focused test and confirm it passes.**

Run:

```powershell
pnpm vitest run src/common/result/index.spec.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Append the migration-log entry and commit this slice.**

Append this section to `docs/02-logs/migration-log/2026-08-22.md`:

```markdown
## 错误处理边界：建立项目 Result 入口

固定 Lucent 的 `neverthrow` 版本并建立 `src/common/result` 显式导出入口。该提交只建立内部 Result seam，不迁移任何业务模块或改变 HTTP/SSE wire contract。
```

Run:

```powershell
pnpm docs:check
git add src/common/result docs/02-logs/migration-log/2026-08-22.md
git commit -m "feat(error): 建立 Result 项目入口"
```

## Task 3: Define DomainFailure and its invariants

**Files:**

- Create: `src/common/result/domain-failure.ts`
- Test: `src/common/result/domain-failure.spec.ts`
- Append: `docs/02-logs/migration-log/2026-08-22.md`

- [ ] **Step 1: Write failing tests for the failure value and type guard.**

Create `src/common/result/domain-failure.spec.ts` with these behaviors:

```ts
import { createDomainFailure, isDomainFailure } from './domain-failure';

describe('DomainFailure', () => {
  it('creates a typed recoverable failure without HTTP fields', () => {
    const failure = createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
      detail: 'The date is invalid.',
      errors: { date: ['Use YYYY-MM-DD.'] },
      retryable: false,
    });

    expect(failure).toMatchObject({
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'VALIDATION_FAILED',
      detail: 'The date is invalid.',
      errors: { date: ['Use YYYY-MM-DD.'] },
      retryable: false,
    });
    expect('status' in failure).toBe(false);
    expect('statusCode' in failure).toBe(false);
    expect(isDomainFailure(failure)).toBe(true);
  });

  it('preserves diagnostic cause without making it a wire field', () => {
    const cause = new Error('database timeout');
    const failure = createDomainFailure({
      kind: 'dependency',
      code: 'DEPENDENCY_TIMEOUT',
      cause,
      retryAfter: 3,
    });

    expect(failure.cause).toBe(cause);
    expect(failure.retryAfter).toBe(3);
  });

  it.each([
    ['', 'empty code'],
    ['SERVER_SHUTDOWN', 'transport-only code'],
    ['STREAM_CANCELLED', 'transport-only code'],
  ])('rejects %s (%s)', (code) => {
    expect(() =>
      createDomainFailure({
        kind: 'internal',
        code: code as never,
      }),
    ).toThrow();
  });

  it('rejects invalid retryAfter and errors values', () => {
    expect(() =>
      createDomainFailure({
        kind: 'rate_limited',
        code: 'RATE_LIMITED',
        retryAfter: -1,
      }),
    ).toThrow();

    expect(() =>
      createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
        errors: [] as never,
      }),
    ).toThrow();
  });

  it('rejects arbitrary values in the type guard', () => {
    expect(isDomainFailure(null)).toBe(false);
    expect(isDomainFailure({ _tag: 'DomainFailure' })).toBe(false);
    expect(
      isDomainFailure({ kind: 'validation', code: 'VALIDATION_FAILED' }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the module is missing.**

Run:

```powershell
pnpm vitest run src/common/result/domain-failure.spec.ts
```

Expected: FAIL because `domain-failure.ts` does not exist.

- [ ] **Step 3: Implement the typed failure value.**

Implement `DomainFailureKind`, `DomainFailureCode`, `DomainFailure`, `CreateDomainFailureInput`, `createDomainFailure`, and `isDomainFailure` exactly as defined in the approved design. The runtime guard must validate `_tag`, `kind`, non-empty `code`, and numeric retry metadata; it must reject `SERVER_SHUTDOWN` and `STREAM_CANCELLED`. It must not add `status`, `statusCode`, `type`, `title`, `requestId`, or localized text.

- [ ] **Step 4: Run the focused test and confirm it passes.**

Run:

```powershell
pnpm vitest run src/common/result/domain-failure.spec.ts
```

Expected: all DomainFailure tests pass.

- [ ] **Step 5: Append the migration-log entry and commit this slice.**

Append:

```markdown
## 错误处理边界：定义 DomainFailure

新增不携带 HTTP 状态或本地化文案的 `DomainFailure` 类型、构造器和运行时类型守卫；保留 cause 仅供诊断，不进入 Problem Details body。
```

Run:

```powershell
pnpm docs:check
git add src/common/result/domain-failure.ts src/common/result/domain-failure.spec.ts docs/02-logs/migration-log/2026-08-22.md
git commit -m "feat(error): 定义 DomainFailure"
```

## Task 4: Add the single DomainFailure-to-ProblemDetails mapper

**Files:**

- Create: `src/common/result/domain-failure.mapper.ts`
- Modify: `src/common/result/index.ts`
- Test: `src/common/result/domain-failure.mapper.spec.ts`
- Append: `docs/02-logs/migration-log/2026-08-22.md`

- [ ] **Step 1: Write the failing mapper tests.**

Create `src/common/result/domain-failure.mapper.spec.ts`:

```ts
import { ProblemCatalog } from '../api/problem-catalog';
import { createDomainFailure } from './domain-failure';
import { toProblemDetails } from './domain-failure.mapper';

describe('toProblemDetails', () => {
  const catalog = new ProblemCatalog({
    t: (key: string) => `translated:${key}`,
  } as never);

  it('delegates status, URI, and localization to ProblemCatalog', () => {
    const failure = createDomainFailure({
      kind: 'conflict',
      code: 'RECORD_ALREADY_EXISTS',
      detail: 'A record already exists for this date.',
      retryable: false,
      cause: new Error('private cause'),
    });

    expect(
      toProblemDetails(failure, {
        catalog,
        lang: 'en',
        traceId: 'trace-123',
      }),
    ).toEqual({
      type: 'https://api.lumos.example/problems/record-already-exists',
      title: 'translated:common.problem_record_already_exists_title',
      detail: 'A record already exists for this date.',
      code: 'RECORD_ALREADY_EXISTS',
      retryable: false,
      traceId: 'trace-123',
    });
  });

  it('forwards safe validation and retry metadata but omits cause', () => {
    const result = toProblemDetails(
      createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
        errors: { date: ['Use YYYY-MM-DD.'] },
        retryAfter: 2,
      }),
      { catalog, lang: 'zh-CN' },
    );

    expect(result).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: { date: ['Use YYYY-MM-DD.'] },
      retryAfter: 2,
    });
    expect(result).not.toHaveProperty('cause');
  });

  it('rejects a malformed or undocumented failure at the mapper seam', () => {
    expect(() =>
      toProblemDetails(
        {
          _tag: 'DomainFailure',
          kind: 'internal',
          code: 'NOT_IN_CATALOG',
        } as never,
        { catalog, lang: 'en' },
      ),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the mapper is missing.**

Run:

```powershell
pnpm vitest run src/common/result/domain-failure.mapper.spec.ts
```

Expected: FAIL because `domain-failure.mapper.ts` and its export do not exist.

- [ ] **Step 3: Implement the mapper and export it from the project entry point.**

Implement:

```ts
export interface DomainFailureProblemOptions {
  catalog: ProblemCatalog;
  lang: string;
  traceId?: string;
}

export function toProblemDetails(
  failure: DomainFailure,
  options: DomainFailureProblemOptions,
): ProblemDetails {
  if (!isDomainFailure(failure) || !options.catalog.isKnown(failure.code)) {
    throw new Error('Invalid or undocumented DomainFailure code');
  }

  return options.catalog.build(failure.code, {
    lang: options.lang,
    ...(failure.detail == null ? {} : { detail: failure.detail }),
    ...(failure.errors == null ? {} : { errors: { ...failure.errors } }),
    ...(failure.retryable == null ? {} : { retryable: failure.retryable }),
    ...(failure.retryAfter == null ? {} : { retryAfter: failure.retryAfter }),
    ...(options.traceId == null ? {} : { traceId: options.traceId }),
  });
}
```

Export `toProblemDetails` and its options type from `src/common/result/index.ts`. Do not catch mapper errors or serialize `failure.cause`.

- [ ] **Step 4: Run the focused Result suite and confirm it passes.**

Run:

```powershell
pnpm vitest run src/common/result/index.spec.ts src/common/result/domain-failure.spec.ts src/common/result/domain-failure.mapper.spec.ts
```

Expected: all focused Result boundary tests pass.

- [ ] **Step 5: Append the migration-log entry and commit this slice.**

Append:

```markdown
## 错误处理边界：建立 DomainFailure Problem Details mapper

新增唯一的 `DomainFailure -> ProblemDetails` 映射入口；HTTP status、Problem URI 和本地化标题/描述继续由 `ProblemCatalog` 负责，cause 不进入 wire body。
```

Run:

```powershell
pnpm docs:check
git add src/common/result docs/02-logs/migration-log/2026-08-22.md
git commit -m "feat(error): 增加 DomainFailure ProblemDetails mapper"
```

## Task 5: Run the foundation gates and inspect the boundary

**Files:**

- Verify: `src/common/result/**`, `package.json`, `pnpm-lock.yaml`
- Verify: `docs/02-logs/migration-log/2026-08-22.md`

- [ ] **Step 1: Run the focused and full unit suites.**

```powershell
pnpm vitest run src/common/result
pnpm test:ci
```

Expected: both commands exit 0; no existing unit test is changed by this foundation slice.

- [ ] **Step 2: Run static and build checks.**

```powershell
pnpm typecheck
pnpm lint:check
pnpm format:check
pnpm build
pnpm docs:verify
```

Expected: all commands exit 0.

- [ ] **Step 3: Verify the scope boundary.**

```powershell
rg -n "ResultAsync|DomainFailure|neverthrow" src/common/result package.json
rg -n "from 'neverthrow'|from \"neverthrow\"" src --glob '*.ts'
git status --short --branch
```

Expected: all direct `neverthrow` imports are inside `src/common/result/index.ts`; no feature module or controller imports the new seam; the working tree is clean.

- [ ] **Step 4: Record the implementation state without closing the parent migration plan.**

Keep `plans/2026-08-18-error-contract-and-neverthrow-migration-plan.md` active because repository/application migration is still pending. Do not delete the parent plan or claim the Result phase complete after this foundation slice.
