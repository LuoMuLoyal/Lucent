import type { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { LifecycleService } from './lifecycle.service';

describe('LifecycleService', () => {
  let loggerLog: vi.MockInstance<any>;
  let configService: vi.Mocked<ConfigService>;
  let service: LifecycleService;

  beforeEach(() => {
    loggerLog = vi.fn();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(loggerLog as never);

    configService = {
      get: vi.fn(),
    } as unknown as vi.Mocked<ConfigService>;

    service = new LifecycleService(configService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onApplicationBootstrap', () => {
    it('logs startup info with env, pid, host, port', () => {
      configService.get
        .mockReturnValueOnce('production') // NODE_ENV
        .mockReturnValueOnce('0.0.0.0') // app.host
        .mockReturnValueOnce(3000); // app.port

      service.onApplicationBootstrap();

      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('Application started'),
      );
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('env=production'),
      );
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('port=3000'),
      );
    });

    it('defaults to development when NODE_ENV is not set', () => {
      configService.get
        .mockReturnValueOnce(undefined) // NODE_ENV
        .mockReturnValueOnce(null) // app.host
        .mockReturnValueOnce(undefined); // app.port

      service.onApplicationBootstrap();

      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('env=development'),
      );
    });
  });

  describe('onApplicationShutdown', () => {
    it('logs shutdown info with signal and uptime', () => {
      service.onApplicationShutdown('SIGTERM');

      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('Application shutting down'),
      );
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('signal=SIGTERM'),
      );
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('uptime='),
      );
    });

    it('logs shutdown with undefined signal', () => {
      service.onApplicationShutdown();

      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('signal=?'),
      );
    });
  });
});
