import { afterEach, describe, expect, it, vi } from 'vitest';

interface Mocks {
  dotenvConfig: ReturnType<typeof vi.fn>;
  sdkStart: ReturnType<typeof vi.fn>;
  sdkConfigs: Array<{ instrumentations?: unknown[] }>;
}

/**
 * Registers shared module mocks and imports `tracing.ts` with a fresh module
 * registry. Returns the spy handles so each test can assert whether the SDK
 * started.
 */
async function importTracing(
  dotenvConfig: Mocks['dotenvConfig'],
): Promise<Mocks> {
  const sdkStart = vi.fn();
  const sdkConfigs: Mocks['sdkConfigs'] = [];

  vi.doMock('dotenv', () => ({
    config: dotenvConfig,
    default: { config: dotenvConfig },
  }));
  vi.doMock('@opentelemetry/auto-instrumentations-node', () => ({
    getNodeAutoInstrumentations: vi.fn(() => []),
  }));
  vi.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
    OTLPTraceExporter: class {
      constructor(readonly options: unknown) {}
    },
  }));
  vi.doMock('@opentelemetry/resources', () => ({
    resourceFromAttributes: vi.fn(() => ({})),
  }));
  vi.doMock('@opentelemetry/sdk-node', () => ({
    NodeSDK: class {
      constructor(config: { instrumentations?: unknown[] }) {
        sdkConfigs.push(config);
      }

      start(): void {
        sdkStart();
      }

      shutdown(): Promise<void> {
        return Promise.resolve();
      }
    },
  }));
  vi.doMock('@prisma/instrumentation', () => ({
    PrismaInstrumentation: class {
      readonly name = 'PrismaInstrumentation';
    },
  }));

  await import('./tracing.js');

  return { dotenvConfig, sdkStart, sdkConfigs };
}

describe('tracing bootstrap', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('dotenv');
    vi.doUnmock('@opentelemetry/auto-instrumentations-node');
    vi.doUnmock('@opentelemetry/exporter-trace-otlp-http');
    vi.doUnmock('@opentelemetry/resources');
    vi.doUnmock('@opentelemetry/sdk-node');
    vi.doUnmock('@prisma/instrumentation');
  });

  it('starts by default when OTEL_ENABLED is unset', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env['OTEL_ENABLED'];

    const { sdkStart, sdkConfigs } = await importTracing(
      vi.fn(() => ({ parsed: {} })),
    );

    expect(sdkStart).toHaveBeenCalledTimes(1);
    // Auto-instrumentations + PrismaInstrumentation.
    expect(sdkConfigs[0]?.instrumentations).toHaveLength(2);
  });

  it('does not start when OTEL_ENABLED=false', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OTEL_ENABLED', 'false');

    const { sdkStart } = await importTracing(vi.fn(() => ({ parsed: {} })));

    expect(sdkStart).not.toHaveBeenCalled();
  });

  it('loads the runtime env before deciding whether tracing is enabled', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env['OTEL_ENABLED'];

    const dotenvConfig = vi.fn((options: { path?: string }) => {
      if (options.path?.endsWith('.env.development')) {
        // The env file disables tracing; if the module read `process.env`
        // before loading the file, the default-on predicate would have started
        // the SDK instead.
        vi.stubEnv('OTEL_ENABLED', 'false');
      }
      return { parsed: {} };
    });

    const { sdkStart } = await importTracing(dotenvConfig);

    expect(dotenvConfig).toHaveBeenCalled();
    expect(sdkStart).not.toHaveBeenCalled();
  });
});
