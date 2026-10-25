---
status: active
owner: backend
quadrant: howto
updated: 2026-10-25
---

# 排查应用启动崩溃（`export:openapi` / `start:dev` 零输出 exit 1）

## 症状

`pnpm export:openapi`、`pnpm openapi:export` 或 `pnpm start:dev` **退出码 1，
但 stdout 与 stderr 都是空的**。`pnpm typecheck`、`pnpm lint:check`、
`pnpm test` 全部通过，看不出任何问题。

## 根因

NestJS 的 `ExceptionsZone` 在 DI 装配失败时的默认处理会把异常**吞掉**。

`@nestjs/core/errors/exceptions-zone.js`：

```js
const DEFAULT_TEARDOWN = () => process.exit(1);

static async asyncRun(callback, teardown = DEFAULT_TEARDOWN, autoFlushLogs) {
  try {
    await callback();
  } catch (e) {
    this.exceptionHandler.handle(e);   // ← 走 Logger
    if (autoFlushLogs) {
      Logger.flush();
    }
    teardown(e);                        // ← process.exit(1)
  }
}
```

`exceptionHandler.handle(e)` 是把错误交给 `Logger.error`，而 `Logger.flush()`
之后立即 `process.exit(1)`——**日志来不及刷到 stdout 就退出了**。
结果就是「零输出 exit 1」。

## 定位手段

用 `--import` 预加载一段 patch，把 `ExceptionsZone.asyncRun` 的 teardown
换成直接打印错误的版本。在仓库根目录建一个临时文件：

```js
// probe.mjs（用完删除，不要提交）
import { ExceptionsZone } from '@nestjs/core/errors/exceptions-zone.js';

const orig = ExceptionsZone.asyncRun;
ExceptionsZone.asyncRun = (cb, _teardown, autoFlush) =>
  orig.call(
    ExceptionsZone,
    cb,
    (e) => {
      console.error('STARTUP ERROR:', e);
    },
    autoFlush,
  );
```

然后：

```powershell
pnpm exec node --import "file:///C:/absolute/path/to/probe.mjs" "scripts/contract/export-openapi.ts"
```

**注意**：`--import` 的路径必须是 `file:///` 形式的绝对路径，且 `probe.mjs`
要放在**仓库根目录**（放在 `$env:TEMP` 里会因为解析不到 `@nestjs/core`
而报 `ERR_MODULE_NOT_FOUND`）。

真实异常就会打印出来，例如：

```text
STARTUP ERROR: UnknownDependenciesException [Error]:
Nest can't resolve dependencies of the AuthOAuthFacadeService
(UserService, ?, Object, Object, Object, Object, ...)
```

## 一个真实实例（2026-10-25）

**现象**：`pnpm export:openapi` 零输出 exit 1。

**根因**：把 `AuthOAuthFacadeService` 的 5 个提供商依赖从**具体类**改成
**端口 interface**（`OAuthProvider`）后，整个应用无法启动。

**为什么三种检查都漏了**：

| 检查              | 为什么没抓到                                                                   |
| ----------------- | ------------------------------------------------------------------------------ |
| `pnpm typecheck`  | interface 在类型层面是完全合法的依赖类型                                       |
| 单元测试          | 手工 `new` 或局部 `TestingModule`（只列自己需要的 provider），**不走完整装配** |
| `pnpm lint:check` | 与 DI 无关                                                                     |

**只有「完整实例化应用」能抓到它**，而 `export:openapi` 恰好是唯一不需要
Postgres/Redis 就能做到这件事的入口——结果它又静默退出了。

**修复**：interface 在运行时不存在，不能当 DI token。给每个提供商绑显式
token：

```ts
export const OAUTH_PROVIDER_TOKENS = {
  wechatWeb: 'OAUTH_PROVIDER_WECHAT_WEB',
  // ...
} as const;

// 注入侧
constructor(
  @Inject(OAUTH_PROVIDER_TOKENS.wechatWeb)
  private readonly wechatWebOAuthProvider: OAuthProvider,
) {}

// 模块侧
{ provide: OAUTH_PROVIDER_TOKENS.wechatWeb, useExisting: WechatWebOAuthProvider },
```

**护栏**：`src/modules/auth/application/services/oauth-facade.di.spec.ts`
断言「5 个提供商参数全部带显式 token」，并有一条**反例锚点**断言
「`design:paramtypes` 在第 1–5 位就是 `Object`」——把「为什么必须 `@Inject`」
钉进测试而不只是写在注释里。

## 通用教训

- **改成端口（interface）时，DI 注入也要一起改。** 类型系统看不见 DI，
  而单测又绕过了 DI 容器——两者之间的空隙正是这类 bug 的藏身处。
- **「零输出 exit 1」优先怀疑被吞掉的启动异常**，而不是脚本逻辑出错。
- `pnpm test` 全绿不等于应用能启动；e2e 的 `createTestApp()`（compile
  `AppModule`）是唯一能覆盖完整装配的测试入口，**本地没跑 e2e 就少了这道网**。
