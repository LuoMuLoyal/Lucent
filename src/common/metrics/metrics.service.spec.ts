import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;
  let configService: jest.Mocked<ConfigService>;

  function createService(
    nodeEnv: string,
    metricsEnabled?: string,
  ): MetricsService {
    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'NODE_ENV') return nodeEnv;
        if (key === 'METRICS_ENABLED') return metricsEnabled;
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    const svc = new MetricsService(mockConfig);
    svc.onApplicationBootstrap();
    return svc;
  }

  beforeEach(async () => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        if (key === 'METRICS_ENABLED') return 'true';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
    service.onApplicationBootstrap();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('is_enabled', () => {
    it('returns true in development when METRICS_ENABLED is not "false"', () => {
      const svc = createService('development', 'true');
      expect(svc.is_enabled()).toBe(true);
    });

    it('returns false when METRICS_ENABLED is "false"', () => {
      const svc = createService('development', 'false');
      expect(svc.is_enabled()).toBe(false);
    });

    it('returns false in test environment regardless of METRICS_ENABLED', () => {
      const svc = createService('test', 'true');
      expect(svc.is_enabled()).toBe(false);
    });
  });

  describe('getMetrics', () => {
    it('returns a non-empty string containing Prometheus metric names', async () => {
      const metrics = await service.getMetrics();
      expect(typeof metrics).toBe('string');
      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics).toContain('http_request_duration_seconds');
      expect(metrics).toContain('http_requests_total');
      expect(metrics).toContain('bullmq_jobs_total');
      expect(metrics).toContain('llm_call_duration_seconds');
      expect(metrics).toContain('llm_tokens_used_total');
    });

    it('includes default Node.js metrics after bootstrap', async () => {
      const metrics = await service.getMetrics();
      expect(metrics).toContain('nodejs_heap_size');
      expect(metrics).toContain('nodejs_version_info');
    });
  });

  describe('getContentType', () => {
    it('returns the Prometheus content type', () => {
      const contentType = service.getContentType();
      expect(contentType).toContain('text/plain');
      expect(contentType).toContain('version=0.0.4');
    });
  });

  describe('recordHttpRequest', () => {
    it('records an HTTP request observation', async () => {
      service.recordHttpRequest('GET', '/api/v1/health', 200, 0.012);

      const metrics = await service.getMetrics();
      expect(metrics).toContain('http_request_duration_seconds_bucket');
      expect(metrics).toContain('http_requests_total');
    });

    it('does not throw when disabled', () => {
      const svc = createService('test', 'false');
      expect(() => {
        svc.recordHttpRequest('GET', '/api/v1/test', 200, 0.01);
      }).not.toThrow();
    });
  });

  describe('recordBullmqJob', () => {
    it('records a BullMQ job completion', async () => {
      service.recordBullmqJob('lucent-mail', 'completed');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('bullmq_jobs_total');
    });

    it('records a BullMQ job failure', async () => {
      service.recordBullmqJob('data-export', 'failed');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('bullmq_jobs_total');
      expect(metrics).toContain('data-export');
    });

    it('does not throw when disabled', () => {
      const svc = createService('test', 'false');
      expect(() => {
        svc.recordBullmqJob('lucent-mail', 'completed');
      }).not.toThrow();
    });
  });

  describe('setBullmqActiveJobs / setBullmqWaitingJobs', () => {
    it('sets active and waiting job gauges', async () => {
      service.setBullmqActiveJobs('lucent-mail', 2);
      service.setBullmqWaitingJobs('lucent-mail', 5);

      const metrics = await service.getMetrics();
      expect(metrics).toContain('bullmq_active_jobs');
      expect(metrics).toContain('bullmq_waiting_jobs');
    });

    it('sets gauges to zero', async () => {
      service.setBullmqActiveJobs('data-export', 0);
      service.setBullmqWaitingJobs('data-export', 0);

      const metrics = await service.getMetrics();
      expect(metrics).toContain('bullmq_active_jobs');
    });

    it('does not throw when disabled', () => {
      const svc = createService('test', 'false');
      expect(() => {
        svc.setBullmqActiveJobs('lucent-mail', 2);
        svc.setBullmqWaitingJobs('lucent-mail', 5);
      }).not.toThrow();
    });
  });

  describe('recordLlmCall', () => {
    it('records an LLM call observation', async () => {
      service.recordLlmCall('analysis', 'gpt-4o', 'success', 1.234);

      const metrics = await service.getMetrics();
      expect(metrics).toContain('llm_call_duration_seconds_bucket');
    });

    it('records an LLM error', async () => {
      service.recordLlmCall('chat', 'deepseek-chat', 'error', 5.0);

      const metrics = await service.getMetrics();
      expect(metrics).toContain('llm_call_duration_seconds_bucket');
      expect(metrics).toContain('error');
    });

    it('records with zero duration', async () => {
      service.recordLlmCall('analysis', 'gpt-4o', 'success', 0);

      const metrics = await service.getMetrics();
      expect(metrics).toContain('llm_call_duration_seconds_bucket');
    });

    it('does not throw when disabled', () => {
      const svc = createService('test', 'false');
      expect(() => {
        svc.recordLlmCall('analysis', 'gpt-4o', 'success', 1.0);
      }).not.toThrow();
    });
  });

  describe('recordLlmTokens', () => {
    it('records token usage', async () => {
      service.recordLlmTokens('analysis', 'gpt-4o', 'prompt', 1500);
      service.recordLlmTokens('analysis', 'gpt-4o', 'completion', 500);

      const metrics = await service.getMetrics();
      expect(metrics).toContain('llm_tokens_used_total');
    });

    it('records zero tokens', async () => {
      service.recordLlmTokens('chat', 'deepseek-chat', 'prompt', 0);

      const metrics = await service.getMetrics();
      expect(metrics).toContain('llm_tokens_used_total');
    });

    it('does not throw when disabled', () => {
      const svc = createService('test', 'false');
      expect(() => {
        svc.recordLlmTokens('analysis', 'gpt-4o', 'prompt', 100);
      }).not.toThrow();
    });
  });
});
