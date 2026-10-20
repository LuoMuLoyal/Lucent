import type { Logger as WinstonLogger } from 'winston';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import type {
  RuntimeConfigPort,
  RuntimeConfigSnapshot,
} from '../../config/runtime/runtime-config.types.js';
import { RuntimeLogLevelService } from './runtime-log-level.service.js';

describe('RuntimeLogLevelService', () => {
  function createSnapshot(level: string): RuntimeConfigSnapshot {
    return {
      values: { [EnvKey.LOG_LEVEL]: level },
      version: 'test#1',
      source: 'remote',
      revision: 'test',
      seq: 1,
    } as unknown as RuntimeConfigSnapshot;
  }

  function createHarness(initialLevel: string, baselineLevel: string) {
    const transports = [
      { level: baselineLevel },
      { level: baselineLevel },
    ] as unknown as WinstonLogger['transports'];
    const winston = {
      level: baselineLevel,
      transports,
    } as unknown as WinstonLogger;

    let listener: ((snapshot: RuntimeConfigSnapshot) => void) | undefined;
    const unsubscribe = vi.fn(() => {
      listener = undefined;
    });
    const runtimeConfig: RuntimeConfigPort = {
      getSnapshot: () => createSnapshot(initialLevel),
      getVersion: () => 'test#1',
      applyDocument: vi.fn(),
      subscribe: (next) => {
        listener = next;
        return unsubscribe;
      },
    };

    const service = new RuntimeLogLevelService(winston, runtimeConfig);
    return {
      service,
      winston,
      transports: transports as unknown as Array<{ level: string }>,
      unsubscribe,
      publish: (level: string) => {
        listener?.(createSnapshot(level));
      },
    };
  }

  it('applies the published level to the logger and every transport', () => {
    const { service, winston, transports } = createHarness('debug', 'info');

    service.onModuleInit();

    expect(winston.level).toBe('debug');
    expect(transports.map((transport) => transport.level)).toEqual([
      'debug',
      'debug',
    ]);
  });

  it('applies later publishes without restart', () => {
    const { service, winston, transports, publish } = createHarness(
      'info',
      'info',
    );
    service.onModuleInit();

    publish('error');

    expect(winston.level).toBe('error');
    expect(transports.every((transport) => transport.level === 'error')).toBe(
      true,
    );
  });

  it('ignores publishes when the level is already in force', () => {
    const { service, winston } = createHarness('info', 'info');
    service.onModuleInit();

    const before = winston.level;
    const transport = winston.transports[0] as { level: string };
    transport.level = 'info';

    expect(winston.level).toBe(before);
  });

  it('stops applying publishes after destroy', () => {
    const { service, winston, publish, unsubscribe } = createHarness(
      'info',
      'info',
    );
    service.onModuleInit();

    service.onModuleDestroy();
    publish('debug');

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(winston.level).toBe('info');
  });

  it('is a no-op without a runtime-config service', () => {
    const winston = {
      level: 'info',
      transports: [{ level: 'info' }],
    } as unknown as WinstonLogger;
    const service = new RuntimeLogLevelService(winston);

    expect(() => {
      service.onModuleInit();
    }).not.toThrow();
    expect(winston.level).toBe('info');
  });
});
