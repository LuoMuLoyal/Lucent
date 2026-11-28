import type { ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';
import { ProblemCatalog } from '../problem-catalog.js';
import { SseProblemDetailsMapper } from './sse-problem-details.js';
import { SseConnectionRegistry } from './sse-connection-registry.service.js';

interface MockSseResponse {
  response: ServerResponse;
  emitter: EventTarget;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function createMockResponse(): MockSseResponse {
  const emitter = new EventTarget();
  const response = emitter as unknown as ServerResponse;
  const write = vi.fn().mockReturnValue(true);
  const end = vi.fn().mockReturnValue(response);
  Object.assign(response, {
    write,
    end,
    // EventTarget has no `.once`; mirror the ServerResponse API used by
    // the registry (`response.once('close', ...)`).
    once: (type: string, listener: () => void) => {
      emitter.addEventListener(type, listener, { once: true });
    },
    writableEnded: false,
    destroyed: false,
  });
  return { response, emitter, write, end };
}

describe('SseConnectionRegistry', () => {
  let registry: SseConnectionRegistry;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(vi.fn() as never);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(vi.fn() as never);
    registry = new SseConnectionRegistry(
      new SseProblemDetailsMapper(
        new ProblemCatalog({ t: vi.fn((key: string) => key) } as never),
      ),
      {
        get: vi.fn(() => undefined),
      } as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('register / unregister', () => {
    it('tracks a registered connection', () => {
      const { response } = createMockResponse();

      registry.register(response);

      expect(registry.size).toBe(1);
    });

    it('does not double-count the same connection registered twice', () => {
      const { response } = createMockResponse();

      registry.register(response);
      registry.register(response);

      expect(registry.size).toBe(1);
    });

    it('stops tracking an unregistered connection', () => {
      const { response } = createMockResponse();

      registry.register(response);
      registry.unregister(response);

      expect(registry.size).toBe(0);
    });

    it('unregisters automatically when the connection emits close (client disconnect)', () => {
      const { response, emitter } = createMockResponse();

      registry.register(response);
      emitter.dispatchEvent(new Event('close'));

      expect(registry.size).toBe(0);
    });
  });

  describe('closeAll', () => {
    it('writes a Problem Details shutdown event, then ends each connection', () => {
      const first = createMockResponse();
      const second = createMockResponse();
      registry.register(first.response, 'zh-CN');
      registry.register(second.response, 'en');

      registry.closeAll();

      for (const { write, end } of [first, second]) {
        expect(write).toHaveBeenCalledWith('event: error\n');
        expect(write).toHaveBeenCalledWith(
          'data: {"type":"https://api.lumos.example/problems/server-shutdown","title":"common.problem_server_shutdown_title","detail":"common.problem_server_shutdown_detail","code":"SERVER_SHUTDOWN","retryable":true,"status":"server_shutdown"}\n\n',
        );
        expect(end).toHaveBeenCalled();
      }
      expect(registry.size).toBe(0);
    });

    it('is a no-op when no connections are tracked', () => {
      expect(() => {
        registry.closeAll();
      }).not.toThrow();
    });

    it('skips connections whose response has already ended', () => {
      const { response, write, end } = createMockResponse();
      Object.assign(response, { writableEnded: true });
      registry.register(response);

      registry.closeAll();

      expect(write).not.toHaveBeenCalled();
      expect(end).not.toHaveBeenCalled();
      expect(registry.size).toBe(0);
    });

    it('keeps closing remaining connections when one write fails', () => {
      const broken = createMockResponse();
      broken.write.mockImplementation(() => {
        throw new Error('socket gone');
      });
      const healthy = createMockResponse();
      registry.register(broken.response);
      registry.register(healthy.response);

      expect(() => {
        registry.closeAll();
      }).not.toThrow();
      expect(healthy.end).toHaveBeenCalled();
      expect(registry.size).toBe(0);
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        { error: 'socket gone' },
        'Failed to close SSE connection during shutdown',
      );
    });
  });

  describe('beforeApplicationShutdown', () => {
    it('closes all tracked connections', () => {
      const { response, end } = createMockResponse();
      registry.register(response);

      registry.beforeApplicationShutdown();

      expect(end).toHaveBeenCalled();
      expect(registry.size).toBe(0);
    });
  });

  describe('admission control', () => {
    function registryWithLimits(
      limits: { max: number; maxPerUser: number },
      metrics?: { setSseActiveConnections: ReturnType<typeof vi.fn> },
    ) {
      return new SseConnectionRegistry(
        new SseProblemDetailsMapper(
          new ProblemCatalog({ t: vi.fn((key: string) => key) } as never),
        ),
        {
          get: vi.fn((key: string) => {
            if (key.includes('PER_USER')) return String(limits.maxPerUser);
            return String(limits.max);
          }),
        } as never,
        metrics as never,
      );
    }

    it('accepts connections below the instance limit', () => {
      const r = registryWithLimits({ max: 2, maxPerUser: 10 });

      expect(r.tryRegister(createMockResponse().response).accepted).toBe(true);
      expect(r.tryRegister(createMockResponse().response).accepted).toBe(true);
    });

    it('rejects with global_limit once the instance cap is reached', () => {
      const r = registryWithLimits({ max: 1, maxPerUser: 10 });
      r.tryRegister(createMockResponse().response);

      const result = r.tryRegister(createMockResponse().response);

      expect(result).toEqual({ accepted: false, reason: 'global_limit' });
      expect(r.size).toBe(1);
    });

    it('rejects with user_limit once one user exceeds their per-user cap', () => {
      const r = registryWithLimits({ max: 100, maxPerUser: 1 });
      r.tryRegister(createMockResponse().response, 'en', 'user-a');

      const result = r.tryRegister(
        createMockResponse().response,
        'en',
        'user-a',
      );

      expect(result).toEqual({ accepted: false, reason: 'user_limit' });
    });

    it('does not count rejected connections against the user budget', () => {
      const r = registryWithLimits({ max: 100, maxPerUser: 1 });
      const first = createMockResponse().response;
      r.tryRegister(first, 'en', 'user-a');
      r.tryRegister(createMockResponse().response, 'en', 'user-a'); // rejected

      // 释放第一条后，同一用户应能重新建立
      r.unregister(first);
      expect(
        r.tryRegister(createMockResponse().response, 'en', 'user-a'),
      ).toEqual({ accepted: true });
    });

    it('frees the user slot on unregister', () => {
      const r = registryWithLimits({ max: 100, maxPerUser: 1 });
      const { response } = createMockResponse();
      r.tryRegister(response, 'en', 'user-a');

      r.unregister(response);

      expect(
        r.tryRegister(createMockResponse().response, 'en', 'user-a'),
      ).toEqual({ accepted: true });
    });

    it('publishes the active-connection gauge on register and unregister', () => {
      const setSseActiveConnections = vi.fn();
      const r = registryWithLimits(
        { max: 100, maxPerUser: 10 },
        { setSseActiveConnections },
      );
      const { response } = createMockResponse();

      r.tryRegister(response);
      expect(setSseActiveConnections).toHaveBeenLastCalledWith(1);

      r.unregister(response);
      expect(setSseActiveConnections).toHaveBeenLastCalledWith(0);
    });
  });
});
