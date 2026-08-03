import { describe, expect, it, vi } from 'vitest';

describe('tracing bootstrap', () => {
  it('loads the runtime env before deciding whether tracing is enabled', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env['OTEL_ENABLED'];

    const dotenvConfig = vi.fn((options: { path?: string }) => {
      if (options.path?.endsWith('.env.development')) {
        // Use vi.stubEnv (not a raw assignment) so vi.unstubAllEnvs() below
        // restores the environment and the change cannot leak into other tests.
        vi.stubEnv('OTEL_ENABLED', 'true');
      }
      return { parsed: {} };
    });
    const sdkStart = vi.fn();

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
        start(): void {
          sdkStart();
        }

        shutdown(): Promise<void> {
          return Promise.resolve();
        }
      },
    }));

    await import('./tracing.js');

    expect(dotenvConfig).toHaveBeenCalled();
    expect(sdkStart).toHaveBeenCalledTimes(1);

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
