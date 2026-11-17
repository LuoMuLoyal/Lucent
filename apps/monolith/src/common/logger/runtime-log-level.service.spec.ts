import { PinoLogger } from 'nestjs-pino';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import type {
  RuntimeConfigPort,
  RuntimeConfigSnapshot,
} from '../../config/runtime/runtime-config.types.js';
import { RuntimeLogLevelService } from './runtime-log-level.service.js';

describe('RuntimeLogLevelService', () => {
  // `PinoLogger.root` is the process-wide pino instance; the service mutates
  // its `level`, which re-gates every child logger at call time.
  const root = { level: 'info' };
  beforeEach(() => {
    root.level = 'info';
    vi.spyOn(PinoLogger, 'root', 'get').mockReturnValue(
      root as unknown as typeof PinoLogger.root,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createSnapshot(level: string): RuntimeConfigSnapshot {
    return {
      values: { [EnvKey.LOG_LEVEL]: level },
      version: 'test#1',
      source: 'remote',
      revision: 'test',
      seq: 1,
    } as unknown as RuntimeConfigSnapshot;
  }

  function createHarness(initialLevel: string) {
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

    const service = new RuntimeLogLevelService(runtimeConfig);
    return {
      service,
      unsubscribe,
      publish: (level: string) => {
        listener?.(createSnapshot(level));
      },
    };
  }

  it('applies the published level to the pino root logger', () => {
    const { service } = createHarness('debug');

    service.onModuleInit();

    expect(root.level).toBe('debug');
    expect(service.levelName).toBe('debug');
  });

  it('maps verbose onto pino trace', () => {
    const { service } = createHarness('verbose');

    service.onModuleInit();

    expect(root.level).toBe('trace');
    expect(service.levelName).toBe('verbose');
  });

  it('applies later publishes without restart', () => {
    const { service, publish } = createHarness('info');
    service.onModuleInit();

    publish('error');

    expect(root.level).toBe('error');
  });

  it('does not reapply an unchanged level', () => {
    const { service } = createHarness('info');
    service.onModuleInit();

    root.level = 'info';
    const setter = vi.spyOn(root, 'level', 'set');
    service.onModuleInit();

    expect(setter).not.toHaveBeenCalled();
  });

  it('stops applying publishes after destroy', () => {
    const { service, publish, unsubscribe } = createHarness('info');
    service.onModuleInit();

    service.onModuleDestroy();
    publish('debug');

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(root.level).toBe('info');
  });

  it('is a no-op without a runtime-config service', () => {
    const service = new RuntimeLogLevelService();

    expect(() => {
      service.onModuleInit();
    }).not.toThrow();
    expect(root.level).toBe('info');
  });
});
