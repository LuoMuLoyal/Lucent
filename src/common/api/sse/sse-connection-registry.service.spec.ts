import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';
import { ProblemCatalog } from '../problem-catalog';
import { SseProblemDetailsMapper } from './sse-problem-details';
import { SseConnectionRegistry } from './sse-connection-registry.service';

interface MockSseResponse {
  response: ServerResponse;
  emitter: EventEmitter;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function createMockResponse(): MockSseResponse {
  const emitter = new EventEmitter();
  const response = emitter as unknown as ServerResponse;
  const write = vi.fn().mockReturnValue(true);
  const end = vi.fn().mockReturnValue(response);
  Object.assign(response, {
    write,
    end,
    writableEnded: false,
    destroyed: false,
  });
  return { response, emitter, write, end };
}

describe('SseConnectionRegistry', () => {
  let registry: SseConnectionRegistry;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(vi.fn() as never);
    registry = new SseConnectionRegistry(
      new SseProblemDetailsMapper(
        new ProblemCatalog({ t: vi.fn((key: string) => key) } as never),
      ),
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
      emitter.emit('close');

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
});
