# Lucent: Express → Fastify 迁移计划

> 状态：迁移完成，所有 Phase 已完成
> 创建日期：2026-07-14
> 最后审查：2026-07-15（与代码库逐文件对照）
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
| `express-formidable`       | 已在 package.json 中但从未使用                  |
| `express-session`          | 仅 AdminJS 间接使用，由 `@fastify/session` 替代 |
| `@types/express`           | 不再需要                                        |

> **注意**：`request-ip` 和 `@types/request-ip` 未安装在当前 `package.json` 中，无需移除。`client-ip.ts` 已直接使用 Express 的 `request.ip`。

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

**当前**（已验证）：

```typescript
const app = await NestFactory.create(AppModule, { bufferLogs: true });
// ...
setupApp(app, configService); // 同步调用，无 await
```

**改动**：

```typescript
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EnvKey } from './config/env-keys.enum';

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({
    trustProxy: process.env[EnvKey.TRUST_PROXY] === 'true',
  }),
  { bufferLogs: true },
);
// ...
await setupApp(app, configService); // 变为 async，需 await
await registerAdminPanel(app, configService);
```

**注意**：

- `trustProxy` 当前在 `setup-app.ts` 中通过 `configService` 读取后调用 `expressInstance.set('trust proxy', ...)` 设置。迁移后在 `main.ts` 中从 `process.env[EnvKey.TRUST_PROXY]` 直接传给 `FastifyAdapter` 构造函数（方案 A，更简单）。此时 `ConfigService` 尚不可用，直接读 `process.env` 是合理的，但必须通过 `EnvKey` 枚举访问，与 `app.config.ts` 中的写法保持一致。
- `setupApp` 变为 `async` 后，此处必须加 `await`。
- `registerAdminPanel` 本身已是 async，但 `setupApp` 变为 async 后需确保调用顺序正确，此处补充以避免遗漏。

---

#### `scripts/contract/export-openapi.ts`

**当前**（已验证）：CJS `require()` 模式，`NestFactory.create(AppModule, { logger: false })` 默认 Express，`setupApp(app, ...)` 同步调用。

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

这是改动量最大的文件。当前代码（已验证）包含：

- 第 8 行：`import type { Express, Request, Response } from 'express';`
- 第 11 行：`import helmet from 'helmet';`
- 第 18-22 行：导入 3 个中间件和 Metrics 相关
- 第 40-41 行：`app.getHttpAdapter().getInstance() as Express` + `set('trust proxy', ...)`
- 第 44 行：`app.use(helmet())`
- 第 46-47 行：`app.use(requestIdMiddleware)` + `app.use(bindRequestContextMiddleware(...))`
- 第 58 行：`app.use(createMetricsMiddleware(metricsService))`
- 第 59-88 行：`app.use('/metrics', authHandler, metricsHandler)` — 含 Express 类型的 `req: Request, res: Response`
- 第 137-144 行：`app.use('/api/docs', apiReference({...}))`

#### 3.2.1 移除 trust proxy 设置

删除第 36-41 行的 trust proxy 逻辑（迁移到 `main.ts` 的 `FastifyAdapter` 构造函数中）。

#### 3.2.2 Helmet

```typescript
// 当前 (L44)
app.use(helmet());

// 改为
import fastifyHelmet from '@fastify/helmet';
// ...
await app.register(fastifyHelmet);
```

`setupApp` 需改为 `async function`。

#### 3.2.3 请求 ID 中间件

**新增导入**（`setup-app.ts` 顶部）：

```typescript
import { randomUUID } from 'crypto';
import {
  REQUEST_ID_HEADER,
  type FastifyRequestWithId,
} from './common/middleware/request-id.types';
```

> `REQUEST_ID_HEADER` 和 `FastifyRequestWithId` 从 `request-id.middleware.ts` 迁移到独立类型文件 `src/common/middleware/request-id.types.ts`（见 §3.7）。

```typescript
// 当前 (L46)
app.use(requestIdMiddleware);

// 改为：注册 Fastify preHandler hook
const fastify = app.getHttpAdapter().getInstance();
fastify.addHook('preHandler', (request, reply, done) => {
  const incoming = request.headers[REQUEST_ID_HEADER.toLowerCase()];
  const requestId =
    typeof incoming === 'string' && incoming.trim()
      ? incoming.trim()
      : randomUUID();
  (request as FastifyRequestWithId).requestId = requestId;
  reply.header(REQUEST_ID_HEADER, requestId);
  done();
});
```

**注意**：

- Fastify 中 header 名自动转小写。`request.header()` 方法不存在，改为 `request.headers[]`。
- `REQUEST_ID_HEADER` 常量保留在 `src/common/middleware/request-id.types.ts`，内联代码必须引用它。
- `randomUUID` 需在 `setup-app.ts` 顶部从 `node:crypto` 导入。
- 使用 `FastifyRequestWithId` 类型扩展替代 `(request as any)`，保持类型安全。

#### 3.2.4 请求上下文中间件

```typescript
// 当前 (L47)
app.use(bindRequestContextMiddleware(app.get(RequestContextService)));

// 改为：同样注册 preHandler hook
fastify.addHook('preHandler', (request, _reply, done) => {
  requestContextService.run(
    { requestId: (request as FastifyRequestWithId).requestId },
    done,
  );
});
```

#### 3.2.5 Metrics 中间件

**新增导入**（`setup-app.ts` 顶部）：

```typescript
import { normalizeRoute, shouldSkip } from './common/metrics/metrics.utils';
```

```typescript
// 当前 (L58)
app.use(createMetricsMiddleware(metricsService));

// 改为：注册 Fastify preHandler + onResponse hooks
fastify.addHook('preHandler', (request, _reply, done) => {
  if (!metricsService.is_enabled() || shouldSkip(request.url)) {
    done();
    return;
  }
  (request as FastifyRequestWithId).__metricsStart = performance.now();
  done();
});
fastify.addHook('onResponse', (request, reply, done) => {
  if (!(request as FastifyRequestWithId).__metricsStart) {
    done();
    return;
  }
  const durationSeconds =
    (performance.now() - (request as FastifyRequestWithId).__metricsStart) /
    1000;
  const route = normalizeRoute(request.url);
  metricsService.recordHttpRequest(
    request.method,
    route,
    reply.statusCode,
    durationSeconds,
  );
  done();
});
```

**注意**：

- `normalizeRoute` 和 `shouldSkip` 从 `metrics.middleware.ts` 迁移到 `src/common/metrics/metrics.utils.ts`（见 §3.7），需在 `setup-app.ts` 顶部导入。
- `FastifyRequestWithId` 类型扩展包含 `__metricsStart?: number` 字段，用于类型安全地存储计时起点。
- Fastify `reply.statusCode` 替代 Express `res.statusCode`。
- Fastify 无 `originalUrl`，统一使用 `request.url`。
- `normalizeRoute` 签名需从 `(req: Request) => string` 改为 `(url: string) => string`。

#### 3.2.6 Metrics 端点

```typescript
// 当前 (L59-88) — Express 风格的 app.use 路由
app.use(
  '/metrics',
  (req: Request, res: Response, next: () => void) => { /* Basic Auth */ },
  async (_req: Request, res: Response) => { res.type(...); res.send(...); },
);

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

#### 3.2.7 Scalar API Reference

```typescript
// 当前 (L137-144)
app.use(
  '/api/docs',
  apiReference({
    spec: { content: document },
    theme: 'purple',
    _integration: 'nestjs',
  }),
);

// 改为：withFastify 模式返回的函数期望第二个参数是原生 ServerResponse，
// 而 Fastify handler 的第二个参数是 FastifyReply（无 writeHead/write/end），
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

`@scalar/nestjs-api-reference` 源码中 `withFastify: true` 分支返回 `(_req, res) => { res.writeHead(...); res.write(...); res.end(); }`，其中 `res` 是原生 `http.ServerResponse`。直接将此函数作为 Fastify handler 传入会导致运行时 TypeError，必须通过 `reply.raw` 获取底层 `ServerResponse`。

> **行为差异**：原 `app.use('/api/docs', ...)` 处理所有 HTTP 方法，改为 `fastify.get` 后仅处理 GET。实践中 API 文档页面只会被 GET 访问，影响可忽略。如需保持全方法兼容可使用 `fastify.all`。

#### 3.2.8 CORS

```typescript
// 当前 (L113-118)
app.enableCors({ origin: ... });

// 改为：无需改动代码
```

NestJS 的 Fastify 适配器内部会自动将 `app.enableCors()` 转为注册 `@fastify/cors`，只需确保 `@fastify/cors` 已安装即可。

#### 3.2.9 签名变更

`setupApp` 当前为同步函数（`export function setupApp(...): void`），改为 `async function`。参数类型从 `INestApplication` 改为 `NestFastifyApplication`：

```typescript
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export async function setupApp(
  app: NestFastifyApplication,
  configService: ConfigService,
): Promise<void>;
```

**影响范围**：`main.ts`、`export-openapi.ts`、`test/helpers/e2e-helpers.ts` 中调用处加 `await`。`e2e-helpers.ts` 中的 `E2eApp` 类型别名需同步更新为 `NestFastifyApplication`（见 §3.11）。

---

### 3.3 SSE 工具 — `src/common/api/sse.ts`

**当前**（已验证）：

```typescript
import type { Response } from 'express';
// response.status() / setHeader() / flushHeaders() / write() / end()
```

**改动**：改为接受 Node.js 原生 `http.ServerResponse`（通过 `reply.raw` 获取），不引入 Fastify 类型依赖。

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

**推荐的控制器改动模式**：

```typescript
import type { FastifyReply } from 'fastify';

@Res() reply: FastifyReply

prepareSse(reply.raw);
writeSseEvent(reply.raw, { ... });
endSse(reply.raw);
```

---

### 3.4 异常过滤器 — `src/common/filters/api-exception.filter.ts`

**当前**（已验证）：

```typescript
import type { Request, Response } from 'express'; // L10
const response = ctx.getResponse<Response>();     // L33
const request = ctx.getRequest<Request>();         // L34
response.status(status).json(errorEnvelope(...));  // L40
const path = request.originalUrl || request.url;   // L51
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

**当前**（已验证）：

```typescript
import type { Request } from 'express'; // L12
const request = context.switchToHttp().getRequest<Request>(); // L39
const path = request.originalUrl || request.url; // L42
```

**改动**：

```typescript
import type { FastifyRequest } from 'fastify';
const request = context.switchToHttp().getRequest<FastifyRequest>();
const path = request.url;
```

---

### 3.6 客户端 IP — `src/common/helpers/client-ip.ts`

**当前**（已验证）：

```typescript
import type { Request } from 'express'; // L1
export function getRequestClientIp(request: Request): string {
  // L10
  return request.ip ?? request.socket.remoteAddress ?? 'unknown-client';
}
```

**改动**：移除 Express 类型导入，改用 Fastify 类型。保持原签名和优先级语义不变。

```typescript
import type { FastifyRequest } from 'fastify';

export function getRequestClientIp(request: FastifyRequest): string {
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown-client';
}
```

> **注意**：
>
> - `request-ip` npm 包未安装在当前项目中，无需从 `package.json` 移除。
> - Fastify 在 `FastifyAdapter({ trustProxy: true })` 配置后，`request.ip` 已自动从 `X-Forwarded-For` 解析，与 Express 的 `trust proxy` 行为一致。无需在函数内部额外判断 `trustProxy`。
> - 保持原优先级：先 `request.ip`，fallback 到 `socket.remoteAddress`，最后 `unknown-client`。5 处调用方无需改动。

---

### 3.7 中间件文件（3 个 → 删除）

这三个文件的逻辑被 `setup-app.ts` 直接内联调用（而非通过 NestJS 中间件系统），采用**策略 A（推荐）**：将逻辑内联到 `setup-app.ts` 的 hook 注册中，删除独立文件。

#### `src/common/middleware/request-id.middleware.ts`

**删除整个文件**。逻辑移入 `setup-app.ts` 的 `preHandler` hook（§3.2.3）。

保留 `REQUEST_ID_HEADER` 常量和 `RequestWithId` 接口——迁移到独立类型文件 **`src/common/middleware/request-id.types.ts`**：

```typescript
import type { FastifyRequest } from 'fastify';

export const REQUEST_ID_HEADER = 'X-Request-Id';

export interface FastifyRequestWithId extends FastifyRequest {
  requestId: string;
  __metricsStart?: number;
}
```

`setup-app.ts` 从此文件导入 `REQUEST_ID_HEADER` 和 `FastifyRequestWithId`。

#### `src/common/logger/request-context.middleware.ts`

**删除整个文件**。逻辑移入 `setup-app.ts` 的 `preHandler` hook（§3.2.4）。

#### `src/common/metrics/metrics.middleware.ts`

**删除整个文件**。`normalizeRoute` 和 `shouldSkip` 工具函数迁移到 **`src/common/metrics/metrics.utils.ts`**（新建文件），并改为 export。hook 逻辑移入 `setup-app.ts`（§3.2.5）。

> **注意**：`normalizeRoute` 当前签名 `function normalizeRoute(req: Request): string` 内部使用 `req.originalUrl || req.url`。迁移后改为接受 `url: string` 参数，因为 Fastify 无 `originalUrl`。`setup-app.ts` 顶部需导入 `import { normalizeRoute, shouldSkip } from './common/metrics/metrics.utils'`。

---

### 3.8 控制器（7 个需改动 + 15 个无需改动）

所有直接导入 Express 类型的控制器需替换为 Fastify 对应类型。以下是**需要改动的 7 个**（已逐文件验证）：

#### `src/app.controller.ts` ✗ 需改动

```typescript
// 当前
import type { Response } from 'express';  // L3
@Res({ passthrough: true }) response: Response  // L19, L42, L58
response.status(code)

// 改为
import type { FastifyReply } from 'fastify';
@Res({ passthrough: true }) reply: FastifyReply
reply.status(code)
```

#### `src/modules/auth/controllers/local.controller.ts` ✗ 需改动

```typescript
// 当前
import type { Request } from 'express';  // L10
@Req() request: Request                 // L50, L64, L81, L114
request.headers['user-agent']

// 改为
import type { FastifyRequest } from 'fastify';
@Req() request: FastifyRequest
```

#### `src/modules/auth/controllers/oauth.controller.ts` ✗ 需改动

```typescript
// 当前
import type { Request, Response } from 'express';  // L19
@Req() request: Request                            // 多处
@Res() response: Response                          // L82
response.redirect(HttpStatus.FOUND, redirectUrl);  // L86

// 改为
import type { FastifyRequest, FastifyReply } from 'fastify';
@Res() reply: FastifyReply
reply.redirect(HttpStatus.FOUND, redirectUrl);
```

Fastify 5 的 `reply.redirect(code, url)` 和 `reply.redirect(url, code)` 均支持。

#### `src/modules/auth/controllers/session.controller.ts` ✗ 需改动

```typescript
// 当前
import type { Request } from 'express'; // L19

// 改为
import type { FastifyRequest } from 'fastify';
```

#### `src/modules/today-analysis/today-analysis.controller.ts` ✗ 需改动

```typescript
// 当前
import type { Response } from 'express';  // L20
@Res() response: Response                // SSE 端点
prepareSse(response); writeSseEvent(response); endSse(response);

// 改为
import type { FastifyReply } from 'fastify';
@Res() reply: FastifyReply
prepareSse(reply.raw); writeSseEvent(reply.raw); endSse(reply.raw);
```

#### `src/modules/reports/reports.controller.ts` ✗ 需改动

同上，SSE 端点改用 `reply.raw`。

额外：PDF 下载端点中的 `response.send(pdf)` → `reply.send(pdf)`。

#### `src/modules/assistant/assistant.controller.ts` ✗ 需改动

同 `today-analysis.controller.ts`，SSE 端点改用 `reply.raw`。

#### 以下 15 个控制器**无需改动**（不直接导入 Express 类型）：

| 控制器                              | 原因            |
| ----------------------------------- | --------------- |
| `environment.controller.ts`         | 无 Express 导入 |
| `user-health-context.controller.ts` | 无 Express 导入 |
| `daily-records.controller.ts`       | 无 Express 导入 |
| `medicine-dose-logs.controller.ts`  | 无 Express 导入 |
| `medicines.controller.ts`           | 无 Express 导入 |
| `medicine-reminders.controller.ts`  | 无 Express 导入 |
| `reminder-deliveries.controller.ts` | 无 Express 导入 |
| `notifications.controller.ts`       | 无 Express 导入 |
| `account.controller.ts`             | 无 Express 导入 |
| `user-settings.controller.ts`       | 无 Express 导入 |
| `today-suggestion.controller.ts`    | 无 Express 导入 |
| `files.controller.ts`               | 无 Express 导入 |
| `data-export.controller.ts`         | 无 Express 导入 |
| `legal-documents.controller.ts`     | 无 Express 导入 |
| `support-resources.controller.ts`   | 无 Express 导入 |
| `testing-support.controller.ts`     | 无 Express 导入 |

---

### 3.9 AdminJS 面板

#### `src/admin/setup.ts`

**当前**（已验证）：

```typescript
import type { INestApplication } from '@nestjs/common'; // L1
import { registerAdminStaticAssets } from './services/static-asset.service'; // L8
import type { AdminJsExpressModule } from './types/types'; // L11
// L38-41: dynamicImport('@adminjs/express') → AdminJsExpressModule
// L63-67: buildAdminAuthRouter(...) → Router
// L69-73: registerAdminStaticAssets(app, ...)
// L74: app.use(admin.options.rootPath, router)
```

**改动**：

```typescript
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
// 删除 registerAdminStaticAssets 导入
import type { AdminJsFastifyModule } from './types/types';

export async function registerAdminPanel(
  app: NestFastifyApplication,
  configService: ConfigService,
): Promise<void> {
  const [adminJsModule, adminFastifyModule, adminPrismaModule] =
    await Promise.all([
      dynamicImport<AdminJsModule>('adminjs'),
      dynamicImport<AdminJsFastifyModule>('@adminjs/fastify'),
      dynamicImport<AdminJsPrismaModule>('@sergiyiva/adminjs-prisma'),
    ]);
  // ... AdminJS 配置不变 ...

  const fastifyInstance = app.getHttpAdapter().getInstance();
  await buildAdminAuthRouter(
    admin,
    configService,
    adminFastifyModule.buildAuthenticatedRouter,
    fastifyInstance,
  );

  // @adminjs/fastify 的 buildAuthenticatedRouter 内部已处理静态资源路由，
  // 不再需要 registerAdminStaticAssets 和 app.use(path, router)
  // ⚠️ 前置验证：执行前需查阅 @adminjs/fastify@4.2.0 源码确认
  //    buildAuthenticatedRouter 是否注册了 Router.assets 对应的静态资源路由。
  //    如果未处理，需将 registerAdminStaticAssets 改写为 Fastify 版本而非删除。
}
```

**关键变化**：

- `@adminjs/express` → `@adminjs/fastify`
- `buildAuthenticatedRouter` 从返回 Express `Router`（同步）变为接受 `FastifyInstance` 参数（异步，返回 `Promise<void>`）
- 删除 `registerAdminStaticAssets` 调用（`@adminjs/fastify` 内部处理）—— **需先验证**
- 删除 `app.use(rootPath, router)` 调用

#### `src/admin/services/auth-router.service.ts`

**当前**（已验证）：返回 Express `Router`，使用 `express-session` 选项。

**改动**：改为 `async function`，直接调用 `@adminjs/fastify` 的 `buildAuthenticatedRouter`。

```typescript
import type { FastifyInstance } from 'fastify';
import type { FastifySessionOptions } from '@fastify/session';
import type { AdminJsFastifyModule, AdminUser } from '../types/types';

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
```

**注意**：`@fastify/session` 的选项与 `express-session` 不同：

- 移除 `resave`、`saveUninitialized`（Fastify session 无这些选项）
- `cookie` 配置保留
- 不要在 `sessionOptions` 中传 `secret` 或 `cookieName`，否则覆盖 `auth` 参数中的值
- ⚠️ **前置验证**：`@fastify/session` 的 `secret` 选项用于签名 session cookie，是安全相关的必需项。执行前需查阅 `@adminjs/fastify@4.2.0` 源码确认 `auth.cookiePassword` 是否被用作 `@fastify/session` 的 `secret`。如果未正确传递，session cookie 将无法签名，AdminJS 登录会失败。

#### `src/admin/services/static-asset.service.ts`

**删除整个文件**。`@adminjs/fastify` 的 `buildRouter` 内部已处理静态资源路由。

同时删除其 spec 文件：`src/admin/services/static-asset.service.spec.ts`。

> ⚠️ **前置验证**：当前项目手动注册静态资源（`adminJsModule.Router.assets`）很可能是因为 `@adminjs/express` 的 `buildAuthenticatedRouter` 未正确处理。如果 `@adminjs/fastify` 同样不处理，删除后 AdminJS 面板将缺少 CSS/JS，页面无法正常渲染。Phase 4 执行前必须确认。

#### `src/admin/types/types.ts`

**当前**（已验证）：

```typescript
import type { Router } from 'express';  // L3

export interface AdminJsExpressModule {   // L16-37
  buildAuthenticatedRouter: (...) => Router;
}
```

**改动**：

```typescript
import type { FastifyInstance } from 'fastify';
import type { FastifySessionOptions } from '@fastify/session';

export interface AdminJsFastifyModule {
  buildAuthenticatedRouter: (
    admin: AdminJSDefault,
    auth: {
      cookieName: string;
      cookiePassword: string;
      authenticate: (email: string, password: string) => AdminUser | null;
    },
    fastifyApp: FastifyInstance,
    sessionOptions?: FastifySessionOptions,
  ) => Promise<void>;
}
```

同时导入 `AuthenticationOptions` 类型（从 `@adminjs/fastify` 导出）。

> ⚠️ **前置验证**：当前 Express 版本的 `buildAuthenticatedRouter` 第 3 个参数是 `predefinedRouter: null`。需查阅 `@adminjs/fastify@4.2.0` 的实际签名，确认第 3 个参数是否为 `FastifyInstance`（如计划所示）或仍保留 `predefinedRouter`。如果签名不同，上述接口定义需相应调整。

#### 以下 AdminJS 文件**无需改动**：

- `src/admin/services/resource-builder.service.ts`
- `src/admin/services/resource-config.service.ts`
- `src/admin/services/prisma-module.service.ts`
- `src/admin/constants/constants.ts`

---

### 3.10 单元测试文件（14 个 spec 需改动）

所有位于 `src/` 下的 spec 文件中的 Express 类型导入需替换。**注意：测试文件全部在 `src/` 下（非 `test/` 目录），`test/` 目录仅包含 E2E 测试。**

| 文件                                                           | Express 类型                      | 改动内容                                                                                                       |
| -------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/common/api/sse.spec.ts`                                   | `Response`                        | mock 改为 `ServerResponse` 方法签名（`writeHead`/`write`/`end`）                                               |
| `src/app.controller.spec.ts`                                   | `Response`                        | mock `reply.status` 替代 `response.status`                                                                     |
| `src/common/filters/api-exception.filter.spec.ts`              | `Response`                        | mock `reply.status().send()` 替代 `response.status().json()`                                                   |
| `src/common/middleware/request-id.middleware.spec.ts`          | `Request, Response, NextFunction` | **随源文件删除**，测试逻辑合并到 `setup-app.spec.ts` 或删除                                                    |
| `src/common/metrics/metrics.middleware.spec.ts`                | `Request, Response, NextFunction` | **随源文件删除**，`normalizeRoute`/`shouldSkip` 的测试移到 `metrics.service.spec.ts` 或新 utils spec           |
| `src/common/logger/request-context.middleware.spec.ts`         | `Request, Response, NextFunction` | **随源文件删除**                                                                                               |
| `src/common/helpers/client-ip.spec.ts`                         | `Request`                         | mock 改为 `FastifyRequest`                                                                                     |
| `src/common/interceptors/slow-request.interceptor.spec.ts`     | `Request`（via mock）             | mock 对象中 `originalUrl` 属性改为仅 `url`，类型改为 `FastifyRequest`                                          |
| `src/modules/auth/controllers/local.controller.spec.ts`        | `Request`                         | mock 对象类型改为 `FastifyRequest`                                                                             |
| `src/modules/auth/controllers/oauth.controller.spec.ts`        | `Request, Response`               | mock 对象类型改，`redirect` mock 签名变化                                                                      |
| `src/modules/auth/controllers/session.controller.spec.ts`      | `Request`                         | 同 local.controller.spec                                                                                       |
| `src/modules/today-analysis/today-analysis.controller.spec.ts` | `Response`                        | mock `makeMockResponse` 改用 `ServerResponse` 方法                                                             |
| `src/modules/reports/reports.controller.spec.ts`               | `Response`                        | 同上                                                                                                           |
| `src/modules/assistant/assistant.controller.spec.ts`           | `Response`（via mock）            | SSE mock 已被 `vi.mock` 隔离，改动最小                                                                         |
| `src/admin/services/auth-router.service.spec.ts`               | 无 Express 导入，但函数签名变化   | 调用加 `await`，mock 从 `mockReturnValue` 改为 `mockResolvedValue`，参数索引偏移，删除“returns the router”用例 |

**无需改动的 spec**：

| 文件                      | 原因                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `src/admin/setup.spec.ts` | 无 Express 导入                                                                    |
| `src/setup-app.spec.ts`   | 仅测试 `formatValidationErrors`/`collectValidationMessages` 纯工具函数，无平台依赖 |

---

### 3.11 E2E 测试（27 个 spec 文件 + helper）

> E2E 测试文件位于 `test/e2e/`、`test/security/`、`test/contract/` 目录下，共 27 个文件。

#### E2E helper

`test/helpers/e2e-helpers.ts` 已存在，需更新 `E2eApp` 类型别名和应用创建逻辑：

```typescript
// 当前
export type E2eApp = INestApplication<App>;
// ...
const app: E2eApp = moduleFixture.createNestApplication();
setupApp(app, app.get(ConfigService));
await app.init();

// 改为
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export type E2eApp = NestFastifyApplication;
// ...
const app: E2eApp = moduleFixture.createNestApplication<NestFastifyApplication>(
  new FastifyAdapter(),
);
await setupApp(app, app.get(ConfigService)); // ← 必须加 await
await app.init();
```

**关键**：

- `E2eApp` 类型别名必须从 `INestApplication<App>` 改为 `NestFastifyApplication`，否则 `createNestApplication<NestFastifyApplication>(new FastifyAdapter())` 返回的类型与 `E2eApp` 不兼容，会导致 TS 编译错误。
- `setupApp` 变为 `async` 后，必须加 `await setupApp(...)`，否则 Fastify 插件注册未完成就启动测试，所有 E2E 测试都会失败。

#### E2E 测试文件（27 个）

这些文件都通过 `createTestApp()` 创建应用，因此只要 helper 改对了，大部分测试文件本身不需要修改。

需逐一检查的点：

- SSE 流式 E2E 测试（`today-analysis.e2e-spec.ts`、`reports.e2e-spec.ts`、`assistant.e2e-spec.ts`）— 验证 SSE 在 Fastify 下正常工作
- OAuth 回调重定向测试（`oauth.e2e-spec.ts`）— 验证 `reply.redirect` 行为一致
- Metrics 端点测试（可能在 `app.e2e-spec.ts` 或安全测试中）— 验证 `/metrics` 端点可访问

---

## 4. 执行阶段

### ~~Phase 1：基础设施迁移（2 天）~~ ✅ 已完成

1. ~~更新 `package.json` 依赖（增删包）+ `pnpm install`~~ — 仅新增 Fastify 包，Express 包待全部迁移后统一移除
2. ~~修改 `src/main.ts` — 切换 `FastifyAdapter` + `trustProxy`~~
3. ~~修改 `src/setup-app.ts` — 所有中间件改为 Fastify hooks/routes，函数签名为 `async`~~
4. ~~修改 `scripts/contract/export-openapi.ts` — `FastifyAdapter` + `await setupApp`~~
5. ~~验证：`pnpm build` 通过~~ — build ✅、typecheck ✅、lint:check ✅

**附加完成项（超出原 Phase 1 范围）：**

- 创建 `src/common/middleware/request-id.types.ts`（原计划 Phase 2 第 10 项）
- 创建 `src/common/metrics/metrics.utils.ts`（原计划 Phase 2 第 12 项）
- 同步更新 5 个 e2e 测试文件的 `setupApp` 调用（原计划 Phase 5 范围）

### ~~Phase 2：公共工具迁移（1 天）~~ ✅ 已完成

6. ~~修改 `src/common/api/sse.ts` — 改用 `ServerResponse`~~
7. ~~修改 `src/common/filters/api-exception.filter.ts` — Fastify 类型~~
8. ~~修改 `src/common/interceptors/slow-request.interceptor.ts` — Fastify 类型~~
9. ~~修改 `src/common/helpers/client-ip.ts` — Fastify 类型~~
10. ~~删除 `src/common/middleware/request-id.middleware.ts`，创建 `src/common/middleware/request-id.types.ts`~~ — types 已在 Phase 1 创建，middleware + spec 已删除
11. ~~删除 `src/common/logger/request-context.middleware.ts`~~ — middleware + spec 已删除
12. ~~删除 `src/common/metrics/metrics.middleware.ts`，创建 `src/common/metrics/metrics.utils.ts`~~ — utils 已在 Phase 1 创建，middleware + spec 已删除

**附带完成项（提前从 Phase 3 拉入）：**

- 3 个 auth 控制器因 `client-ip.ts` 类型变更导致 build 失败，提前迁移：`local.controller.ts`、`oauth.controller.ts`、`session.controller.ts`（含 `@Req()` → `FastifyRequest`，`@Res()` → `FastifyReply`，`redirect(code, url)` → `redirect(url, code)`）
- 对应 3 个 `.spec.ts` 文件同步更新

### ~~Phase 3：控制器迁移（0.5 天）~~ ✅ 已完成

13. ~~`src/app.controller.ts`~~
14. ~~`src/modules/auth/controllers/local.controller.ts`~~ — Phase 2 已完成
15. ~~`src/modules/auth/controllers/oauth.controller.ts`~~ — Phase 2 已完成
16. ~~`src/modules/auth/controllers/session.controller.ts`~~ — Phase 2 已完成
17. ~~`src/modules/today-analysis/today-analysis.controller.ts`~~
18. ~~`src/modules/reports/reports.controller.ts`~~
19. ~~`src/modules/assistant/assistant.controller.ts`~~

**同步修改的 spec 文件：**

- `src/app.controller.spec.ts` — mock 类型从 `Response` 改为 `FastifyReply`
- `src/modules/today-analysis/today-analysis.controller.spec.ts` — `makeMockResponse` 改为 `makeMockReply`，返回 `{ raw: { writeHead, write, end } }`
- `src/modules/reports/reports.controller.spec.ts` — 同上，额外保留 `send` 方法用于 PDF 端点
- `src/modules/assistant/assistant.controller.spec.ts` — mock response 从 `{} as never` 改为 `{ raw: {} } as unknown as FastifyReply`，断言从 `response` 改为 `response.raw`

### ~~Phase 4：AdminJS 迁移（1 天）~~ ✅ 已完成

20. ~~修改 `src/admin/types/types.ts`~~ — `AdminJsExpressModule` → `AdminJsFastifyModule`，移除 `Router` express 导入，改用 `FastifyInstance`
21. ~~修改 `src/admin/setup.ts`~~ — `@adminjs/express` → `@adminjs/fastify`，`INestApplication` → `NestFastifyApplication`，移除 `registerAdminStaticAssets` 和 `app.use()`，改用 `fastifyInstance` 参数传给 `buildAdminAuthRouter`
22. ~~修改 `src/admin/services/auth-router.service.ts`~~ — 函数从同步返回 `Router` 改为 `async` 返回 `Promise<void>`，新增 `fastifyInstance: FastifyInstance` 参数，移除 `predefinedRouter: null` 和 Express session 选项（`resave`/`saveUninitialized`/`secret`/`name`），仅保留 `cookie` 配置
23. ~~删除 `src/admin/services/static-asset.service.ts` + spec~~ — `@adminjs/fastify` 的 `buildRouter` 内部已处理静态资源路由

**前置验证结果（@adminjs/fastify@4.2.0 源码）：**

- `buildAuthenticatedRouter(admin, auth, fastifyApp, sessionOptions)` — async，返回 `Promise<void>`
- `auth.cookiePassword` 用作 `@fastify/cookie` 和 `@fastify/session` 的 `secret`
- `auth.cookieName` 用作 session cookie 名
- `sessionOptions` 仅需传 `cookie` 配置，`secret`/`cookieName` 由 `auth` 提供
- `buildRouter(admin, fastifyApp)` 内部注册所有 AdminJS 路由 + 静态资源路由（`assets.forEach(...)`）

**同步修改的 spec 文件：**

- `src/admin/services/auth-router.service.spec.ts` — mock 从 `mockReturnValue` 改为 `mockResolvedValue`，新增 `mockFastifyInstance` 参数，所有调用改为 `await`，删除"returns the router"用例，新增"passes fastifyInstance"用例
- `src/admin/services/index.ts` — 移除 `static-asset.service` 导出

### Phase 5：测试修复（2-3 天）

24. ~~修改/创建 E2E helper~~ — Phase 1 已完成
25. ~~修复 15 个单元 spec 文件的 Express 类型替换（含 `auth-router.service.spec.ts`）~~ — Phase 2/3/4 已完成
26. ~~删除 3 个随源文件删除的 middleware spec~~ — Phase 2 已完成
27. ~~删除 `static-asset.service.spec.ts`~~ — Phase 4 已完成
28. ~~修复 `src/admin/services/auth-router.service.spec.ts`（async 签名 + mock 更新）~~ — Phase 4 已完成
29. 运行 `pnpm test:ci` 全量通过
30. 运行 `pnpm test:e2e:ci` 全量通过

### Phase 6：验证与收尾（1 天）

31. `pnpm lint:check` — 零警告
32. `pnpm typecheck` — 零错误
33. `pnpm build` — 成功
34. `pnpm export:openapi` — OpenAPI 规范无变化
35. 手动验证：AdminJS 面板可登录、可浏览资源
36. 手动验证：SSE 流式端点正常工作
37. 手动验证：Metrics 端点正常返回
38. 手动验证：Scalar API 文档页面可访问
39. 更新 `docs/environment.md`（如有 Fastify 特有配置）

---

## 5. 风险与缓解

### 5.1 SSE 流式响应

**风险**：Fastify 的 `reply.raw` 是原生 `http.ServerResponse`，SSE 直接操作它是可行的，但需注意 Fastify 的响应生命周期管理。Fastify 默认在 handler 返回后自动发送响应，如果已经通过 `reply.raw` 手动发送了响应，需要确保不会重复发送。

**缓解**：SSE 端点使用 `@Res()` （`passthrough: false`），NestJS 将不自动发送响应。Fastify 在 handler 不返回值时也不会自动发送。

### 5.2 `@adminjs/fastify` 的 NestJS 集成

**风险**：`@adminjs/fastify` 的 `buildAuthenticatedRouter` 需要传入 `FastifyInstance`，而 NestJS 的 `app.getHttpAdapter().getInstance()` 返回的实例类型需要确认。

**缓解**：在 `main.ts` 中使用 `FastifyAdapter` 后，`getInstance()` 返回 `FastifyInstance`。`@nestjs/platform-fastify` 的类型定义已保证这一点。

### 5.3 `express-formidable` 和 `express-session` 的幽灵依赖

**风险**：这两个包在 `package.json` 中但源码中未直接 `import`（`express-formidable` 完全未用，`express-session` 由 `@adminjs/express` 间接依赖）。移除后需确认无其他隐式依赖。

**缓解**：`@adminjs/fastify` 的依赖列表中已包含 `@fastify/session` 和 `@fastify/multipart`，不再需要 Express 对应包。

### 5.4 `trustProxy` 配置

**风险**：当前 Express 的 `trustProxy` 通过 `setup-app.ts` 中 `expressInstance.set('trust proxy', configValue)` 设置。Fastify 在 adapter 构造函数中通过 `trustProxy: true/false` 配置。

**缓解**：在 `main.ts` 中从 `process.env[EnvKey.TRUST_PROXY]` 读取传给 `FastifyAdapter`。`app.config.ts` 中的 `trustProxy` 配置保留（其他代码可能引用），但 `setup-app.ts` 中的 trust proxy 设置代码删除。

### 5.5 E2E 测试中的 supertest 行为差异

**风险**：`supertest` 在 Fastify 下通过 `app.getHttpServer()` 获取底层 HTTP 服务器，行为与 Express 下基本一致。但某些细节（如 `response.headers` 的格式）可能略有差异。

**缓解**：全量运行 E2E 测试套件（27 个文件），逐一排查失败项。

### 5.6 Body parsing 默认行为差异

**风险**：Express 默认 body size limit 为 100KB，Fastify 默认为 1MB。LLM prompt 等场景可能涉及较大 body。

**缓解**：在 `FastifyAdapter` 构造函数中显式配置 `bodyLimit`：

```typescript
import { EnvKey } from './config/env-keys.enum';
// ...
new FastifyAdapter({
  trustProxy: process.env[EnvKey.TRUST_PROXY] === 'true',
  bodyLimit: 1024 * 1024 * 2, // 2MB
});
```

### 5.7 `@nestjs/throttler` 兼容性

**风险**：`@nestjs/throttler@^6.5.0` 可能对 Fastify 适配器有特殊要求。

**缓解**：`@nestjs/throttler` 官方支持 Fastify。如在 Phase 1 验证中发现问题，可能需要额外配置 throttler 的 storage 适配器。

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
- `src/common/logger/` 除 `request-context.middleware.ts` — 日志（`logger.config.ts`、`lifecycle.service.ts`、`request-context.service.ts` 等）
- `src/common/metrics/metrics.service.ts` — metrics 服务（但需接纳 `normalizeRoute`/`shouldSkip` 迁入）
- `src/admin/services/resource-builder.service.ts` — 资源构建
- `src/admin/services/resource-config.service.ts` — 资源配置
- `src/admin/services/prisma-module.service.ts` — Prisma 模块
- `src/admin/constants/constants.ts` — 常量
- 所有 `src/modules/*/services/` 和 `src/modules/*/dto/` — 业务逻辑
- 15 个无 Express 导入的控制器（见 §3.8 列表）
- `src/i18n/` — 国际化
- `src/mail/` — 邮件
- `src/common/storage/` — 存储模块
- `src/common/queue/` — 队列模块
- `src/common/llm/` — LLM 公共设施
- `generated/` — 生成代码

---

## 7. 改动文件统计

| 类别           | 修改                                                                                                         | 删除                                      | 新增                                      | 合计    |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------- | ------- |
| 启动/配置      | 3 (`main.ts`, `setup-app.ts`, `export-openapi.ts`)                                                           | 0                                         | 0                                         | 3       |
| 公共设施       | 5 (`sse.ts`, `api-exception.filter.ts`, `slow-request.interceptor.ts`, `client-ip.ts`, `metrics.service.ts`) | 3 (middleware 文件)                       | 2 (metrics.utils.ts, request-id.types.ts) | 10      |
| 控制器         | 7                                                                                                            | 0                                         | 0                                         | 7       |
| AdminJS        | 3 (`types.ts`, `setup.ts`, `auth-router.service.ts`)                                                         | 1 (`static-asset.service.ts` + spec)      | 0                                         | 4       |
| 单元测试       | ~13                                                                                                          | ~4 (middleware specs + static-asset spec) | 0                                         | ~17     |
| E2E 测试       | 1 (helper)                                                                                                   | 0                                         | 0                                         | 1       |
| `package.json` | 1                                                                                                            | 0                                         | 0                                         | 1       |
| **合计**       | **~36**                                                                                                      | **~8**                                    | **2**                                     | **~46** |

---

## 8. 回滚方案

如果迁移完成后发现严重问题，回滚步骤：

1. `git checkout -- package.json pnpm-lock.yaml`
2. `pnpm install`
3. `git checkout -- src/main.ts src/setup-app.ts scripts/contract/export-openapi.ts`
4. 恢复所有被修改/删除的文件
5. `pnpm build && pnpm test:ci`

建议在每个 Phase 结束后打一个 git commit tag（如 `phase1-fastify-migration`），便于快速回滚到任意阶段。

---

## 9. 审查记录（2026-07-15）

> 2026-07-15 逐文件对照代码库审查后发现 14 个问题，已全部内联修复。修复内容涵盖：
>
> 1. `process.env` 访问统一使用 `EnvKey` 枚举（§3.1, §5.4, §5.6）
> 2. 内联 hook 代码复用 `REQUEST_ID_HEADER` 常量，补充 `randomUUID` 导入（§3.2.3）
> 3. `(request as any)` 改为 `FastifyRequestWithId` 类型扩展（§3.2.3-3.2.5）
> 4. `client-ip.ts` 移除不必要 `trustProxy` 参数，保持原签名和优先级语义（§3.6）
> 5. `normalizeRoute`/`shouldSkip` 明确迁移到 `metrics.utils.ts` 并补充导入（§3.2.5, §3.7）
> 6. `setup-app.spec.ts` 确认无需改动——仅测试纯工具函数（§3.10）
> 7. `auth-router.service.spec.ts` 移入"需改动"列表（§3.10）
> 8. Scalar `app.use` → `fastify.get` 行为差异注明（§3.2.7）
> 9. AdminJS 静态资源/session secret/接口签名添加 ⚠️ 前置验证说明（§3.9）
> 10. `main.ts` 补全 `registerAdminPanel` 调用（§3.1）
> 11. E2E helper 补充 `E2eApp` 类型别名更新（§3.11）
> 12. `REQUEST_ID_HEADER`/`FastifyRequestWithId` 迁移到 `request-id.types.ts`（§3.7）
> 13. 执行阶段步骤和统计表同步更新（§4, §7）
