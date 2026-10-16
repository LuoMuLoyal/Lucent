/**
 * OpenTelemetry SDK 初始化（副作用模块，最终 `export {}`）。
 *
 * 必须是 main.ts 的第一个 import —— OTel 必须在任何其他模块（HTTP 客户端、
 * 数据库驱动等）被加载之前完成 SDK 注册与自动插桩，否则已加载的库无法被
 * 自动插桩捕获。
 *
 * **默认开启**：仅当 `OTEL_ENABLED === 'false'` 时才不启动 SDK。默认值在
 * `environment.validation.ts` 里同样是 `'true'`，两处必须一致（本模块在
 * ConfigModule 之前运行，读裸 `process.env`，看不到 zod 默认值）。
 *
 * 启用后 HTTP/DB/Redis/Prisma 请求自动产生 span，经 OTLP HTTP 上报至
 * OTEL_EXPORTER_OTLP_ENDPOINT（默认 http://127.0.0.1:4318/v1/traces）。
 * 采样由 OTel 标准环境变量 `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`
 * 控制（NodeSDK 未显式传 `sampler` 时调用 `createSamplerFromEnv()`），
 * 用作 Prisma query span 的体积过滤手段。
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { getEnvFilePaths } from './config/env/env-file-paths.js';

// ESM equivalent of `__dirname` — this module is the first import of
// `main.ts` and must not rely on CJS globals.
const thisDir = dirname(fileURLToPath(import.meta.url));

/**
 * Loads the same environment files that ConfigModule will use later during
 * bootstrap. This module runs before Nest creates ConfigModule, so the OTel
 * enablement flag must be available here rather than only after Nest starts.
 * Existing process environment variables keep precedence over dotenv files.
 *
 * Resolves env files relative to `thisDir` (project root in both dev `src/`
 * and built `dist/`), so tracing works regardless of the process working
 * directory (PM2 / systemd / Docker).
 */
function loadTracingEnvironment(): void {
  for (const envFilePath of getEnvFilePaths()) {
    loadDotenv({
      path: join(thisDir, '..', envFilePath),
      override: false,
    });
  }
}

loadTracingEnvironment();

/**
 * Whether the OTel SDK should start. **Default on**: only an explicit
 * `OTEL_ENABLED=false` disables it. The matching default lives in
 * `environment.validation.ts` (`z.enum(['true','false']).default('true')`);
 * keep the two in lockstep.
 */
const enabled = process.env['OTEL_ENABLED'] !== 'false';

if (enabled) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': 'lucent' }),
    traceExporter: new OTLPTraceExporter({
      url:
        process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ??
        'http://127.0.0.1:4318/v1/traces',
    }),
    // `PrismaInstrumentation` must be registered before the Prisma Client is
    // first instantiated — this module is main.ts's first import, so that
    // holds. Sampler selection stays with the OTel standard env vars
    // (`OTEL_TRACES_SAMPLER`), which NodeSDK reads via `createSamplerFromEnv()`.
    instrumentations: [
      getNodeAutoInstrumentations(),
      new PrismaInstrumentation(),
    ],
  });

  sdk.start();

  const shutdown = () => {
    void sdk.shutdown();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export {};
