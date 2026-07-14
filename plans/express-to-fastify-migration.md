# Lucent: Express → Fastify 迁移计划

> 状态：待执行
> 创建日期：2026-07-14
> 预估工时：8-10 人天
> 前置条件：无阻塞项（`@adminjs/fastify@4.2.0` 兼容当前 `adminjs@^7.8.17`）

---

## 1. 背景与动机

当前 Lucent 使用 `@nestjs/platform-express` 作为 HTTP 适配器。Fastify 相比 Express 在以下方面有优势：

- 更高的请求吞吐量（基准测试中通常 2-3 倍于 Express）
- 内置 JSON schema 验证
- 更低的内存开销
- 原生异步支持

之前的评估中认为 AdminJS 无 Fastify 适配器是致命阻塞项，经核实 AdminJS 官方提供了 `@adminjs/fastify@4.2.0`，与当前 `adminjs@^7.8.17` 兼容，该阻塞项不存在。

---

## 2. 依赖变更

### 2.1 新增

| 包名                       | 版本      | 用途                                                              |
| -------------------------- | --------- | ----------------------------------------------------------------- |
| `@nestjs/platform-fastify` | `^11.1.0` | NestJS Fastify 适配器                                             |
| `@adminjs/fastify`         | `^4.2.0`  | AdminJS Fastify 适配器                                            |
| `@fastify/helmet`          | `^13.0.0` | 安全头（替代 `helmet`）                                           |
| `@fastify/cors`            | `^11.0.0` | CORS（`app.enableCors()` 依赖）                                   |
| `@fastify/static`          | `^9.0.0`  | `@nestjs/platform-fastify` peer 依赖                              |
| `@fastify/view`            | `^11.0.0` | `@nestjs/platform-fastify` peer 依赖                              |
| `@fastify/session`         | `^11.1.0` | 类型导入（`FastifySessionOptions`）                               |
| `fastify`                  | `^5.0.0`  | 类型导入（`FastifyRequest` / `FastifyReply` / `FastifyInstance`） |

> **说明**：`@fastify/cookie`、`@fastify/formbody`、`@fastify/multipart` 由 `@adminjs/fastify` 内部依赖，项目代码不直接导入，无需显式声明。Fastify 5 自带 TypeScript 类型定义，不需要 `@types/fastify`（该包在 Fastify 5 生态中不存在）。

### 2.2 移除

| 包名                       | 原因                                            |
| -------------------------- | ----------------------------------------------- |
| `@nestjs/platform-express` | 不再使用 Express                                |
| `@adminjs/express`         | 替换为 `@adminjs/fastify`                       |
| `helmet`                   | 替换为 `@fastify/helmet`                        |
| `request-ip`               | 替换为 Fastify 内置 `request.ip`                |
| `express-formidable`       | 已在 package.json 中但从未使用                  |
| `express-session`          | 仅 AdminJS 间接使用，由 `@fastify/session` 替代 |
| `@types/express`           | 不再需要                                        |
| `@types/request-ip`        | 不再需要                                        |

### 2.3 保留不变

- `adminjs@^7.8.17` — 框架无关
- `@sergiyiva/adminjs-prisma@^2.0.1` — 框架无关
- `@scalar/nestjs-api-reference@^1.2.6` — 内置 `withFastify` 选项
- `@nestjs/swagger@^11.4.4` — 框架无关
- `supertest` — 兼容 Fastify 的 `app.getHttpServer()`

---

## 3. 逐文件改动清单

### 3.1 启动入口

#### `src/main.ts`

**当前**：`NestFactory.create(AppModule, { bufferLogs: true })` 默认创建 Express 实例。

**改动**：

```typescript
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ trustProxy: /* from config */ }),
  { bufferLogs: true },
);
```

**注意**：`trustProxy` 当前在 `app.config.ts` 中通过环境变量 `TRUST_PROXY` 配置，需要传入 `FastifyAdapter` 构造函数。但因为 `main.ts` 在 DI 容器初始化前执行，有两种方案：

- 方案 A：在 `main.ts` 中手动读取 `process.env.TRUST_PROXY` 传给 adapter
- 方案 B：在 `setupApp` 中通过 `app.getHttpAdapter().getInstance()` 修改

推荐方案 A（更简单）。

**注意**：`setupApp` 变为 `async` 后，`main.ts` 中调用处需加 `await`：`await setupApp(app, configService);`。

---

#### `scripts/contract/export-openapi.ts`

**当前**：该脚本全程使用 CJS `require()`，`NestFactory.create(AppModule, { logger: false })` 默认 Express，`setupApp(app, ...)` 同步调用。

**改动**：

```javascript
const { FastifyAdapter } = require('@nestjs/platform-fastify');

const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
  logger: false,
});
await setupApp(app, app.get(ConfigService));
```

注意 `setupApp` 变为 `async` 后，此处也需加 `await`。

---

### 3.2 应用配置 — `src/setup-app.ts`

这是改动量最大的文件。当前有 5 处 `app.use()` 调用和大量 Express 类型引用。

#### 3.2.1 Helmet

```typescript
// 当前
app.use(helmet());

// 改为
await app.register(fastifyHelmet);
```

注意 `setupApp` 需改为 `async function`。

#### 3.2.2 请求 ID 中间件

```typescript
// 当前
app.use(requestIdMiddleware);

// 改为：注册 Fastify preHandler hook
app
  .getHttpAdapter()
  .getInstance()
  .addHook('preHandler', (request, reply, done) => {
    const incoming = request.headers[REQUEST_ID_HEADER.toLowerCase()];
    const requestId =
      typeof incoming === 'string' && incoming.trim()
        ? incoming.trim()
        : randomUUID();
    (request as RequestWithId).requestId = requestId;
    reply.header(REQUEST_ID_HEADER, requestId);
    done();
  });
```

**注意**：Fastify 中 header 名自动转小写。`request.header()` 方法不存在，改为 `request.headers[]`。

#### 3.2.3 请求上下文中间件

```typescript
// 当前
app.use(bindRequestContextMiddleware(app.get(RequestContextService)));

// 改为：同样注册 preHandler hook
app
  .getHttpAdapter()
  .getInstance()
  .addHook('preHandler', (request, _reply, done) => {
    requestContextService.run(
      { requestId: (request as RequestWithId).requestId },
      done,
    );
  });
```

#### 3.2.4 Metrics 中间件

```typescript
// 当前
app.use(createMetricsMiddleware(metricsService));

// 改为：注册 Fastify preHandler + onResponse hooks
const fastify = app.getHttpAdapter().getInstance();
fastify.addHook('preHandler', (request, _reply, done) => {
  if (!metricsService.is_enabled() || shouldSkip(request.url)) {
    done();
    return;
  }
  (request as any).__metricsStart = performance.now();
  done();
});
fastify.addHook('onResponse', (request, reply, done) => {
  if (!(request as any).__metricsStart) {
    done();
    return;
  }
  const durationSeconds =
    (performance.now() - (request as any).__metricsStart) / 1000;
  const route = normalizeRoute(request);
  metricsService.recordHttpRequest(
    request.method,
    route,
    reply.statusCode,
    durationSeconds,
  );
  done();
});
```

**注意**：Fastify `reply.statusCode` 替代 Express `res.statusCode`。`request.url` 替代 `request.originalUrl`（Fastify 无 `originalUrl`）。

#### 3.2.5 Metrics 端点

```typescript
// 当前
app.use('/metrics', authMiddleware, metricsHandler);

// 改为：Fastify 路由
fastify.get('/metrics', async (request, reply) => {
  // Basic Auth 逻辑不变，但用 reply 代替 res
  if (metricsUser && metricsPassword) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      reply.header('WWW-Authenticate', 'Basic realm="Metrics"');
      reply.code(401).send('Unauthorized');
      return;
    }
    // ... 解码逻辑不变 ...
  }
  reply.type(metricsService.getContentType());
  reply.send(await metricsService.getMetrics());
});
```

#### 3.2.6 Scalar API Reference

```typescript
// 当前
app.use('/api/docs', apiReference({ spec: { content: document }, ... }));

// 改为：withFastify 模式返回的函数期望第二个参数是原生 ServerResponse（拥有 writeHead/write/end），
// 而 Fastify 路由 handler 的第二个参数是 FastifyReply（无这些方法），
// 因此必须用 reply.raw 包装。
fastify.get('/api/docs', (request, reply) => {
  apiReference({
    spec: { content: document },
    theme: 'purple',
    _integration: 'nestjs',
    withFastify: true,
  })(request, reply.raw);
});
```

`@scalar/nestjs-api-reference` 源码中 `withFastify: true` 分支返回 `(_req, res) => { res.writeHead(...); res.write(...); res.end(); }`，其中 `res` 是原生 `http.ServerResponse`。直接将此函数作为 Fastify handler 传入会导致运行时 TypeError（`FastifyReply` 无 `writeHead` / `write` / `end` 方法），必须通过 `reply.raw` 获取底层 `ServerResponse` 传入。

#### 3.2.7 CORS

```typescript
// 当前
app.enableCors({ origin: ... });

// 改为：无需改动代码
```

NestJS 的 Fastify 适配器内部会自动将 `app.enableCors()` 转为注册 `@fastify/cors`，只需确保 `@fastify/cors` 已安装即可。原代码保持不变。

#### 3.2.8 签名变更

`setupApp` 当前为同步函数，改为 `async function`（因为 `app.register` 是异步的）。同时参数类型从 `INestApplication` 改为 `NestFastifyApplication`：

```typescript
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export async function setupApp(
  app: NestFastifyApplication,
  configService: ConfigService,
): Promise<void>;
```

`main.ts`、`export-openapi.ts`、`test/helpers/e2e-helpers.ts` 中调用处加 `await`。

---

### 3.3 SSE 工具 — `src/common/api/sse.ts`

**当前**：参数类型为 Express `Response`，调用 `response.status()`、`response.setHeader()`、`response.flushHeaders()`、`response.write()`、`response.end()`。

**改动**：改为接受 Node.js 原生 `http.ServerResponse`（通过 `reply.raw` 获取）。这样既兼容 Fastify 又不引入 Fastify 类型依赖。

```typescript
import type { ServerResponse } from 'node:http';

export function prepareSse(response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

export function writeSseEvent<T>(
  response: ServerResponse,
  message: SseMessage<T>,
): void {
  response.write(`event: ${message.event}\n`);
  response.write(`data: ${JSON.stringify(message.data)}\n\n`);
}

export function endSse(response: ServerResponse): void {
  response.end();
}
```

**影响**：控制器中 `@Res() response: Response` 改为获取原生 response。在 Fastify 下 `@Res() reply: FastifyReply` 然后传 `reply.raw`。或者直接声明类型为 `FastifyReply` 并在调用处传 `.raw`。

**推荐的控制器改动模式**：

```typescript
import type { FastifyReply } from 'fastify';

@Res() reply: FastifyReply

// 在调用 SSE 工具时传 reply.raw
prepareSse(reply.raw);
writeSseEvent(reply.raw, { ... });
endSse(reply.raw);
```

---

### 3.4 异常过滤器 — `src/common/filters/api-exception.filter.ts`

**当前**：

```typescript
import type { Request, Response } from 'express';
const response = ctx.getResponse<Response>();
const request = ctx.getRequest<Request>();
response.status(status).json(errorEnvelope(...));
const path = request.originalUrl || request.url;
```

**改动**：

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify';
const response = ctx.getResponse<FastifyReply>();
const request = ctx.getRequest<FastifyRequest>();
response.status(status).send(errorEnvelope(...));
const path = request.url;  // Fastify 无 originalUrl
```

---

### 3.5 拦截器 — `src/common/interceptors/slow-request.interceptor.ts`

**当前**：

```typescript
import type { Request } from 'express';
const request = context.switchToHttp().getRequest<Request>();
const path = request.originalUrl || request.url;
```

**改动**：

```typescript
import type { FastifyRequest } from 'fastify';
const request = context.switchToHttp().getRequest<FastifyRequest>();
const path = request.url;
```

---

### 3.6 客户端 IP — `src/common/helpers/client-ip.ts`

**当前**：依赖 `request-ip` 库和 Express `Request` 类型。

**改动**：移除 `request-ip` 依赖。Fastify 内置 `request.ip`，且通过 `trustProxy` 配置自动解析 `X-Forwarded-For`。

```typescript
import type { FastifyRequest } from 'fastify';

export function getRequestClientIp(
  request: FastifyRequest,
  trustProxy = false,
): string {
  if (trustProxy) {
    return request.ip ?? 'unknown-client';
  }
  // 不信任代理时，直接用 socket 远端地址
  return request.socket?.remoteAddress ?? request.ip ?? 'unknown-client';
}
```

**注意**：Fastify 的 `request.ip` 在设置了 `trustProxy` 时自动从 `X-Forwarded-For` 提取，无需第三方库。`FastifyRequest` 接口继承自 `http.IncomingMessage`，`request.socket` 可直接访问。如果遇到类型问题，可使用 `request.raw.socket` 作为备选方案。

---

### 3.7 中间件文件（3 个）

这三个文件从 Express 中间件改为 Fastify hooks。但由于它们的逻辑被 `setup-app.ts` 直接内联调用（而非通过 NestJS 中间件系统），可以有两种策略：

- **策略 A（推荐）**：将逻辑直接内联到 `setup-app.ts` 的 hook 注册中，删除这三个独立文件
- **策略 B**：保留文件但改为导出 hook 函数

推荐策略 A，因为这些函数仅在 `setup-app.ts` 中使用一次，内联后更清晰。

#### `src/common/middleware/request-id.middleware.ts`

删除文件，逻辑移入 `setup-app.ts` 的 `preHandler` hook。

保留 `REQUEST_ID_HEADER` 常量和 `RequestWithId` 接口导出（可移入 `setup-app.ts` 或保留在公共类型中）。

#### `src/common/logger/request-context.middleware.ts`

删除文件，逻辑移入 `setup-app.ts` 的 `preHandler` hook。

#### `src/common/metrics/metrics.middleware.ts`

删除文件。`normalizeRoute` 和 `shouldSkip` 工具函数保留（可移入 `metrics.service.ts` 或独立 util 文件），hook 逻辑移入 `setup-app.ts`。

---

### 3.8 控制器（7 个）

所有控制器将 `import type { Request, Response } from 'express'` 替换为 `import type { FastifyRequest, FastifyReply } from 'fastify'`。

#### `src/app.controller.ts`

```typescript
// 当前
@Res({ passthrough: true }) response: Response
response.status(code)

// 改为
@Res({ passthrough: true }) reply: FastifyReply
reply.status(code)
```

#### `src/modules/auth/controllers/local.controller.ts`

```typescript
// 当前
@Req() request: Request
request.headers['user-agent']

// 改为
@Req() request: FastifyRequest
request.headers['user-agent']
```

**注意**：Fastify 的 `request.headers` 返回的类型与 Express 略有不同（值可能是 `string | string[]`），但 `'user-agent'` 总是 `string | undefined`，行为一致。

#### `src/modules/auth/controllers/oauth.controller.ts`

```typescript
// 当前
@Res() response: Response
response.redirect(HttpStatus.FOUND, redirectUrl);

// 改为
@Res() reply: FastifyReply
reply.redirect(HttpStatus.FOUND, redirectUrl);
```

Fastify 的 `reply.redirect()` 签名与 Express 不同：`reply.redirect(code, url)` → `reply.redirect(url, code)` 或 `reply.redirect(code, url)`（Fastify 5 中两者都支持）。

#### `src/modules/auth/controllers/session.controller.ts`

同 `local.controller.ts`，`@Req() request: FastifyRequest`。

#### `src/modules/today-analysis/today-analysis.controller.ts`

```typescript
// 当前
@Res() response: Response
prepareSse(response);
writeSseEvent(response, { ... });
endSse(response);

// 改为
@Res() reply: FastifyReply
prepareSse(reply.raw);
writeSseEvent(reply.raw, { ... });
endSse(reply.raw);
```

#### `src/modules/reports/reports.controller.ts`

同上，SSE 端点改用 `reply.raw`。

额外：`downloadClinicSummaryPdf` 和 `downloadSharedClinicSummaryPdf` 中的 `response.send(pdf)` 改为 `reply.send(pdf)`。

#### `src/modules/assistant/assistant.controller.ts`

同 `today-analysis.controller.ts`，SSE 端点改用 `reply.raw`。

---

### 3.9 AdminJS 面板

#### `src/admin/setup.ts`

**当前**：

```typescript
const [adminJsModule, adminExpressModule, adminPrismaModule] =
  await Promise.all([
    dynamicImport<AdminJsModule>('adminjs'),
    dynamicImport<AdminJsExpressModule>('@adminjs/express'),
    dynamicImport<AdminJsPrismaModule>('@sergiyiva/adminjs-prisma'),
  ]);
// ...
const router = buildAdminAuthRouter(
  admin,
  configService,
  buildAuthenticatedRouter,
);
registerAdminStaticAssets(
  app,
  admin.options.rootPath,
  adminJsModule.Router.assets,
);
app.use(admin.options.rootPath, router);
```

**改动**：

函数签名从 `app: INestApplication` 改为 `app: NestFastifyApplication`，使 `app.getHttpAdapter().getInstance()` 返回 `FastifyInstance` 而非 `unknown`。

````typescript
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export async function registerAdminPanel(
  app: NestFastifyApplication,
  configService: ConfigService,
): Promise<void> {
  const [adminJsModule, adminFastifyModule, adminPrismaModule] = await Promise.all([
    dynamicImport<AdminJsModule>('adminjs'),
    dynamicImport<AdminJsFastifyModule>('@adminjs/fastify'),
    dynamicImport<AdminJsPrismaModule>('@sergiyiva/adminjs-prisma'),
  ]);
  // ...
  const fastifyInstance = app.getHttpAdapter().getInstance();
  await buildAdminAuthRouter(admin, configService, adminFastifyModule.buildAuthenticatedRouter, fastifyInstance);
  // 静态资源由 @adminjs/fastify 内部处理，不再需要 registerAdminStaticAssets
}

**关键变化**：
- `@adminjs/express` 的 `buildAuthenticatedRouter` 返回 Express `Router`，通过 `app.use(path, router)` 挂载
- `@adminjs/fastify` 的 `buildAuthenticatedRouter` 接受 `FastifyInstance` 参数，直接在实例上注册路由（`async` 函数，返回 `Promise<void>`）
- `@adminjs/fastify` 的 `buildRouter` 内部已处理静态资源路由（`assets.forEach` → `fastifyApp.get`），不再需要 `registerAdminStaticAssets`

#### `src/admin/services/auth-router.service.ts`

**当前**：返回 Express `Router`，使用 `express-session` 选项（`resave`、`saveUninitialized`、`secret`、`name`）。

**改动**：改为 `async function`，直接调用 `@adminjs/fastify` 的 `buildAuthenticatedRouter`。

```typescript
import type { FastifyInstance } from 'fastify';
import type { FastifySessionOptions } from '@fastify/session';

export async function buildAdminAuthRouter(
  admin: AdminJSDefault,
  configService: ConfigService,
  buildAuthenticatedRouter: AdminJsFastifyModule['buildAuthenticatedRouter'],
  fastifyInstance: FastifyInstance,
): Promise<void> {
  // ... 读取 config 不变 ...
  await buildAuthenticatedRouter(
    admin,
    {
      cookieName: 'lucent-admin',
      cookiePassword: cookieSecret,
      authenticate: (email, password): AdminUser | null => /* 不变 */,
    },
    fastifyInstance,
    {
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
      },
    },
  );
}
````

**注意**：`@fastify/session` 的选项与 `express-session` 不同：

- 移除 `resave`、`saveUninitialized`（Fastify session 无这些选项）
- `secret` 通过 `@fastify/cookie` 的 `secret` 传递（`buildAuthenticatedRouter` 内部注册 `@fastify/cookie` 时使用 `auth.cookiePassword` 作为 secret）
- `name` → `cookieName`（已在 auth 参数中设置）
- `cookie` 配置保留
- **不要**在 `sessionOptions` 中传 `secret` 或 `cookieName`，否则会覆盖 `auth` 参数中的值。`buildAuthenticatedRouter` 内部展开 `sessionOptions` 时后者优先。

#### `src/admin/services/static-asset.service.ts`

**删除整个文件**。`@adminjs/fastify` 的 `buildRouter` 内部已处理静态资源。

#### `src/admin/types/types.ts`

```typescript
// 当前
import type { Router } from 'express';

export interface AdminJsExpressModule {
  buildAuthenticatedRouter: (...) => Router;
}

// 改为
import type { FastifyInstance } from 'fastify';
import type { FastifySessionOptions } from '@fastify/session';

export interface AdminJsFastifyModule {
  buildAuthenticatedRouter: (
    admin: AdminJSDefault,
    auth: AuthenticationOptions,
    fastifyApp: FastifyInstance,
    sessionOptions?: FastifySessionOptions,
  ) => Promise<void>;
}
```

同时导入 `AuthenticationOptions` 类型（从 `@adminjs/fastify` 导出）。

#### `src/admin/services/resource-builder.service.ts` — 无改动

#### `src/admin/services/resource-config.service.ts` — 无改动

#### `src/admin/services/prisma-module.service.ts` — 无改动

#### `src/admin/constants/constants.ts` — 无改动

---

### 3.10 单元测试文件（17 个 spec）

所有 spec 文件中的 `import type { ... } from 'express'` 需替换为 Fastify 对应类型。改动是机械性的，但量大。

| 文件                                                           | Express 类型                      | 改动内容                                                                       |
| -------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| `src/common/api/sse.spec.ts`                                   | `Response`                        | mock 改为 `ServerResponse` 方法签名                                            |
| `src/app.controller.spec.ts`                                   | `Response`                        | mock `reply.status` 替代 `response.status`                                     |
| `src/common/filters/api-exception.filter.spec.ts`              | `Response`                        | mock `reply.status().send()` 替代 `response.status().json()`                   |
| `src/common/middleware/request-id.middleware.spec.ts`          | `Request, Response, NextFunction` | 随源文件删除或改为测试 hook                                                    |
| `src/common/metrics/metrics.middleware.spec.ts`                | `Request, Response, NextFunction` | 随源文件删除或改为测试 hook                                                    |
| `src/common/logger/request-context.middleware.spec.ts`         | `Request, Response, NextFunction` | 随源文件删除或改为测试 hook                                                    |
| `src/common/helpers/client-ip.spec.ts`                         | `Request`                         | mock 改为 `FastifyRequest`                                                     |
| `src/common/interceptors/slow-request.interceptor.spec.ts`     | `Request`（via mock）             | mock 对象中 `originalUrl` 属性改为仅 `url`，类型改为 `FastifyRequest`          |
| `src/modules/auth/controllers/local.controller.spec.ts`        | `Request`                         | mock 对象类型改为 `FastifyRequest`                                             |
| `src/modules/auth/controllers/oauth.controller.spec.ts`        | `Request, Response`               | mock 对象类型改，`redirect` mock 签名变化                                      |
| `src/modules/auth/controllers/session.controller.spec.ts`      | `Request`                         | 同 local.controller.spec                                                       |
| `src/modules/today-analysis/today-analysis.controller.spec.ts` | `Response`                        | mock `makeMockResponse` 改用 `ServerResponse` 方法                             |
| `src/modules/reports/reports.controller.spec.ts`               | `Response`                        | 同上                                                                           |
| `src/modules/assistant/assistant.controller.spec.ts`           | `Response`（via mock）            | SSE mock 已被 `vi.mock` 隔离，改动最小                                         |
| `src/admin/setup.spec.ts`                                      | 无 Express 导入                   | 无改动                                                                         |
| `src/admin/services/auth-router.service.spec.ts`               | 无 Express 导入                   | mock `buildAuthenticatedRouter` 签名变化（返回 `Promise<void>` 而非 `Router`） |
| `src/admin/services/static-asset.service.spec.ts`              | 无 Express 导入                   | **删除**（随源文件删除）                                                       |

---

### 3.11 E2E 测试（24 个 spec 文件 + 1 个 helper）

#### `test/helpers/e2e-helpers.ts`

**当前**：

```typescript
const app: E2eApp = moduleFixture.createNestApplication();
setupApp(app, app.get(ConfigService));
await app.init();
```

**改动**：

```typescript
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export type E2eApp = NestFastifyApplication;

const app = moduleFixture.createNestApplication<NestFastifyApplication>(
  new FastifyAdapter(),
);
await setupApp(app, app.get(ConfigService));
await app.init();
```

**关键**：`setupApp` 变为 `async` 后，必须加 `await setupApp(...)`，否则 Fastify 插件注册未完成就启动测试，所有 E2E 测试都会失败。

`E2eApp` 类型从 `INestApplication<App>` 改为 `NestFastifyApplication`。

`supertest` 与 Fastify 的兼容性：`app.getHttpServer()` 返回 Fastify 底层的 `http.Server` 实例，`supertest` 可以直接使用。但需要 `await app.init()` 后再调用 `app.getHttpServer()`（Fastify 需要额外 `await app.getHttpAdapter().getInstance().ready()`，但 NestJS 的 `app.init()` 已处理）。

#### E2E 测试文件（24 个）

这些文件都通过 `createTestApp()` 创建应用，因此只要 helper 改对了，大部分测试文件本身不需要修改。

需要逐一检查的点：

- 如果有测试直接检查 `request.headers` 或 `request.ip` 的 Express 特定行为
- SSE 流式 E2E 测试（如 `today-analysis.e2e-spec.ts`、`reports.e2e-spec.ts`、`assistant.e2e-spec.ts`）需验证 SSE 在 Fastify 下正常工作
- OAuth 回调重定向测试（`oauth.e2e-spec.ts`）需验证 `reply.redirect` 行为一致

---

## 4. 执行阶段

### Phase 1：基础设施迁移（2 天）

1. 更新 `package.json` 依赖（增删包）
2. 修改 `src/main.ts` — 切换 `FastifyAdapter`
3. 修改 `src/setup-app.ts` — 所有中间件改为 Fastify hooks/routes
4. 修改 `scripts/contract/export-openapi.ts`
5. 验证：`pnpm build` 通过，服务能启动，`GET /api/v1/health` 返回 200

### Phase 2：公共工具迁移（1 天）

6. 修改 `src/common/api/sse.ts` — 改用 `ServerResponse`
7. 修改 `src/common/filters/api-exception.filter.ts` — Fastify 类型
8. 修改 `src/common/interceptors/slow-request.interceptor.ts` — Fastify 类型
9. 修改 `src/common/helpers/client-ip.ts` — 移除 `request-ip`
10. 删除 `src/common/middleware/request-id.middleware.ts`
11. 删除 `src/common/logger/request-context.middleware.ts`
12. 删除 `src/common/metrics/metrics.middleware.ts`（保留 `normalizeRoute`/`shouldSkip` 移入 util）

### Phase 3：控制器迁移（1 天）

13. `src/app.controller.ts`
14. `src/modules/auth/controllers/local.controller.ts`
15. `src/modules/auth/controllers/oauth.controller.ts`
16. `src/modules/auth/controllers/session.controller.ts`
17. `src/modules/today-analysis/today-analysis.controller.ts`
18. `src/modules/reports/reports.controller.ts`
19. `src/modules/assistant/assistant.controller.ts`

### Phase 4：AdminJS 迁移（1 天）

20. 修改 `src/admin/types/types.ts` — `AdminJsExpressModule` → `AdminJsFastifyModule`
21. 修改 `src/admin/setup.ts` — 使用 `@adminjs/fastify`
22. 修改 `src/admin/services/auth-router.service.ts` — 异步 + `FastifyInstance`
23. 删除 `src/admin/services/static-asset.service.ts`

### Phase 5：测试修复（2-3 天）

24. 修改 `test/helpers/e2e-helpers.ts` — `FastifyAdapter` + `await setupApp`
25. 修复 16 个 spec 文件（机械性类型替换，含 `slow-request.interceptor.spec.ts`）
26. 删除 `static-asset.service.spec.ts`
27. 运行 `pnpm test:ci` 全量通过
28. 运行 `pnpm test:e2e:ci` 全量通过

### Phase 6：验证与收尾（1 天）

29. `pnpm lint:check` — 零警告
30. `pnpm typecheck` — 零错误
31. `pnpm build` — 成功
32. `pnpm export:openapi` — OpenAPI 规范无变化
33. 手动验证：AdminJS 面板可登录、可浏览资源
34. 手动验证：SSE 流式端点正常工作
35. 手动验证：Metrics 端点正常返回
36. 手动验证：Scalar API 文档页面可访问
37. 更新 `docs/environment.md`（如有 Fastify 特有配置）

---

## 5. 风险与缓解

### 5.1 SSE 流式响应

**风险**：Fastify 的 `reply.raw` 是原生 `http.ServerResponse`，SSE 直接操作它是可行的，但需注意 Fastify 的响应生命周期管理。Fastify 默认在 handler 返回后自动发送响应，如果已经通过 `reply.raw` 手动发送了响应，需要确保 NestJS/Fastify 不会重复发送。

**缓解**：SSE 端点使用 `@Res()` （`passthrough: false`），NestJS 将不自动发送响应。Fastify 在 handler 不返回值时也不会自动发送。

### 5.2 `@adminjs/fastify` 的 NestJS 集成

**风险**：`@adminjs/fastify` 的 `buildAuthenticatedRouter` 需要传入 `FastifyInstance`，而 NestJS 的 `app.getHttpAdapter().getInstance()` 返回的实例需要确认是 `FastifyInstance` 类型。

**缓解**：在 `main.ts` 中使用 `FastifyAdapter` 后，`getInstance()` 返回 `FastifyInstance`。`@nestjs/platform-fastify` 的类型定义已保证这一点。

### 5.3 `express-formidable` 和 `express-session` 的幽灵依赖

**风险**：这两个包在 `package.json` 中但源码中未直接 `import`（`express-formidable` 完全未用，`express-session` 由 `@adminjs/express` 间接依赖）。移除后需确认无其他隐式依赖。

**缓解**：`@adminjs/fastify` 的依赖列表中已包含 `@fastify/session` 和 `@fastify/multipart`，不再需要 Express 对应包。

### 5.4 `trustProxy` 配置

**风险**：当前 Express 的 `trustProxy` 通过 `app.set('trust proxy', ...)` 或 `request-ip` 库处理。Fastify 在 adapter 构造函数中通过 `trustProxy: true/false` 配置。

**缓解**：在 `main.ts` 中从 `process.env` 读取 `TRUST_PROXY` 传给 `FastifyAdapter`。`app.config.ts` 中的 `trustProxy` 配置保留不变（其他代码可能引用）。

### 5.5 E2E 测试中的 supertest 行为差异

**风险**：`supertest` 在 Fastify 下通过 `app.getHttpServer()` 获取底层 HTTP 服务器，行为与 Express 下基本一致。但某些细节（如 `response.headers` 的格式）可能略有差异。

**缓解**：全量运行 E2E 测试套件，逐一排查失败项。

### 5.6 Body parsing 默认行为差异

**风险**：Express 默认 body size limit 为 100KB，Fastify 默认为 1MB。如果项目有接收较大 JSON body 的场景（如 LLM prompt 等），可能遇到 `BodyParserError: Body exceeded 1mb limit`（Fastify）或相反方向的限制差异。

**缓解**：在 `FastifyAdapter` 构造函数中显式配置 `bodyLimit`，或确认所有端点的 body 均在 1MB 以内。如有需要：

```typescript
new FastifyAdapter({ bodyLimit: 1024 * 1024 * 2 }); // 2MB
```

---

## 6. 不改动的部分

以下文件/模块无需修改：

- `src/app.module.ts` — 模块定义与 HTTP 平台无关
- `src/app.service.ts` — 业务逻辑
- `src/app.dto.ts` — DTO
- `src/config/` 全部 — 配置逻辑
- `src/prisma/` 全部 — 数据库
- `src/common/api/api-envelope.ts` — 响应封装
- `src/common/interceptors/api-envelope.interceptor.ts` — 拦截器逻辑（通过 `ExecutionContext` 访问，平台无关）
- `src/common/interceptors/skip-api-envelope.decorator.ts` — 装饰器
- `src/common/logger/` 除 `request-context.middleware.ts` — 日志
- `src/common/metrics/metrics.service.ts` — metrics 服务
- `src/admin/services/resource-builder.service.ts` — 资源构建
- `src/admin/services/resource-config.service.ts` — 资源配置
- `src/admin/services/prisma-module.service.ts` — Prisma 模块
- `src/admin/constants/constants.ts` — 常量
- 所有 `src/modules/*/services/` 和 `src/modules/*/dto/` — 业务逻辑
- `src/i18n/` — 国际化
- `src/mail/` — 邮件
- `src/llm-runtime/` — LLM 运行时
- `src/common/storage/` — 存储模块
- `src/common/queue/` — 队列模块
- `src/common/llm/` — LLM 公共设施
- `generated/` — 生成代码

---

## 7. 改动文件统计

| 类别         | 修改   | 删除  | 新增      | 合计   |
| ------------ | ------ | ----- | --------- | ------ |
| 启动/配置    | 3      | 0     | 0         | 3      |
| 公共设施     | 5      | 3     | 1（util） | 9      |
| 控制器       | 7      | 0     | 0         | 7      |
| AdminJS      | 3      | 1     | 0         | 4      |
| 单元测试     | 15     | 1     | 0         | 16     |
| E2E 测试     | 1      | 0     | 0         | 1      |
| package.json | 1      | 0     | 0         | 1      |
| **合计**     | **35** | **5** | **1**     | **41** |
