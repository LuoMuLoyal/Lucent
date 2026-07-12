import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import { LifecycleService } from './lifecycle.service';

describe('LifecycleService', () => {
  let logger: vi.Mocked<PinoLogger>;
  let configService: vi.Mocked<ConfigService>;
  let service: LifecycleService;

  beforeEach(() => {
    logger = {
      setContext: vi.fn(),
      info: vi.fn(),
    } as unknown as vi.Mocked<PinoLogger>;

    configService = {
      get: vi.fn(),
    } as unknown as vi.Mocked<ConfigService>;

    service = new LifecycleService(logger, configService);
  });

  describe('constructor', () => {
    it('sets context on logger', () => {
      expect(logger.setContext).toHaveBeenCalledWith('LifecycleService');
    });
  });

  describe('onApplicationBootstrap', () => {
    it('logs startup info with env, pid, host, port', () => {
      configService.get
        .mockReturnValueOnce('production') // NODE_ENV
        .mockReturnValueOnce('0.0.0.0') // app.host
        .mockReturnValueOnce(3000); // app.port

      service.onApplicationBootstrap();

      expect(logger.info).toHaveBeenCalledWith(
        {
          env: 'production',
          pid: process.pid,
          host: '0.0.0.0',
          port: 3000,
        },
        'Application started',
      );
    });

    it('defaults to development when NODE_ENV is not set', () => {
      configService.get
        .mockReturnValueOnce(undefined) // NODE_ENV
        .mockReturnValueOnce(null) // app.host
        .mockReturnValueOnce(undefined); // app.port

      service.onApplicationBootstrap();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          env: 'development',
          host: null,
          port: undefined,
        }),
        'Application started',
      );
    });
  });

  describe('onApplicationShutdown', () => {
    it('logs shutdown info with signal and uptime', () => {
      service.onApplicationShutdown('SIGTERM');

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          signal: 'SIGTERM',
          pid: process.pid,
        }),
        'Application shutting down',
      );

      const callArgs = logger.info.mock.calls[0]![0] as Record<string, unknown>;
      expect(typeof callArgs['uptimeSeconds']).toBe('number');
    });

    it('logs shutdown with undefined signal', () => {
      service.onApplicationShutdown();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          signal: undefined,
        }),
        'Application shutting down',
      );
    });
  });
});
