/**
 * OpenTelemetry SDK 初始化（副作用模块，最终 `export {}`）。
 *
 * 必须是 main.ts 的第一个 import —— OTel 必须在任何其他模块（HTTP 客户端、
 * 数据库驱动等）被加载之前完成 SDK 注册与自动插桩，否则已加载的库无法被
 * 自动插桩捕获。
 *
 * 由 OTEL_ENABLED=true 门控：默认关闭时不启动 SDK，现有开发流程与测试
 * 行为不变。启用后 HTTP/DB/Redis 请求自动产生 span，经 OTLP HTTP 上报至
 * OTEL_EXPORTER_OTLP_ENDPOINT（默认 http://127.0.0.1:4318/v1/traces）。
 */

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';

const enabled = process.env['OTEL_ENABLED'] === 'true';

if (enabled) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': 'lucent' }),
    traceExporter: new OTLPTraceExporter({
      url:
        process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ??
        'http://127.0.0.1:4318/v1/traces',
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  const shutdown = () => {
    void sdk.shutdown();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export {};
