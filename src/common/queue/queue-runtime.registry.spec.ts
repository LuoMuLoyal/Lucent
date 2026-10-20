import type { Worker } from 'bullmq';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import type {
  RuntimeConfigPort,
  RuntimeConfigSnapshot,
} from '../../config/runtime/runtime-config.types.js';
import {
  QUEUE_CONCURRENCY_KEYS,
  QueueRuntimeRegistry,
} from './queue-runtime.registry.js';
import { QUEUE_NAME_LIST, QUEUE_NAMES } from './queue-names.js';

function snapshot(values: Record<string, unknown>): RuntimeConfigSnapshot {
  return {
    values: values as never,
    version: 'test#1',
    source: 'remote',
    revision: 'test',
    seq: 1,
  };
}

function runtimeWith(initial: Record<string, unknown>) {
  const listeners = new Set<(next: RuntimeConfigSnapshot) => void>();
  let current = snapshot(initial);
  const port: RuntimeConfigPort = {
    getSnapshot: () => current,
    getVersion: () => current.version,
    applyDocument: () => ({ ok: true, version: current.version, changed: [] }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    port,
    publish(values: Record<string, unknown>): void {
      current = snapshot(values);
      for (const listener of listeners) {
        listener(current);
      }
    },
  };
}

function fakeWorker(concurrency = 1): Worker {
  return { concurrency } as Worker;
}

describe('QueueRuntimeRegistry', () => {
  it('declares a concurrency key for every registered queue', () => {
    expect(Object.keys(QUEUE_CONCURRENCY_KEYS).toSorted()).toEqual(
      [...QUEUE_NAME_LIST].toSorted(),
    );
  });

  it('reads the published value and falls back to the caller default', () => {
    const { port } = runtimeWith({
      [EnvKey.QUEUE_CRON_CONCURRENCY]: 6,
      [EnvKey.QUEUE_MEAL_ANALYSIS_CONCURRENCY]: 2,
    });
    const registry = new QueueRuntimeRegistry(port);

    expect(registry.readConcurrency(QUEUE_NAMES.cron, 1)).toBe(6);
    // 未发布的队列不会凭空得到某个值：调用点的 1 仍然是答案。
    expect(registry.readConcurrency(QUEUE_NAMES.medicineRecognition, 1)).toBe(
      1,
    );
    expect(registry.readConcurrency(QUEUE_NAMES.mealAnalysis, 1)).toBe(2);
  });

  it('applies the current value when a worker is registered', () => {
    const { port } = runtimeWith({
      [EnvKey.QUEUE_TODAY_ANALYSIS_CONCURRENCY]: 4,
    });
    const registry = new QueueRuntimeRegistry(port);
    const worker = fakeWorker(1);

    registry.register(QUEUE_NAMES.todayAnalysis, worker);

    expect(worker.concurrency).toBe(4);
  });

  it('retunes registered workers when a document is published', () => {
    const { port, publish } = runtimeWith({
      [EnvKey.QUEUE_CRON_CONCURRENCY]: 1,
    });
    const registry = new QueueRuntimeRegistry(port);
    registry.onModuleInit();
    const worker = fakeWorker(1);
    registry.register(QUEUE_NAMES.cron, worker);

    publish({ [EnvKey.QUEUE_CRON_CONCURRENCY]: 4 });

    expect(worker.concurrency).toBe(4);
    registry.onModuleDestroy();
  });

  it('leaves other queues untouched when only one key changes', () => {
    const { port, publish } = runtimeWith({});
    const registry = new QueueRuntimeRegistry(port);
    registry.onModuleInit();
    const cronWorker = fakeWorker(2);
    const mailWorker = fakeWorker(3);
    registry.register(QUEUE_NAMES.cron, cronWorker);
    registry.register(QUEUE_NAMES.mail, mailWorker);

    publish({ [EnvKey.QUEUE_CRON_CONCURRENCY]: 5 });

    expect(cronWorker.concurrency).toBe(5);
    expect(mailWorker.concurrency).toBe(3);
    registry.onModuleDestroy();
  });

  it('stops retuning a worker after it is unregistered', () => {
    const { port, publish } = runtimeWith({});
    const registry = new QueueRuntimeRegistry(port);
    registry.onModuleInit();
    const worker = fakeWorker(1);
    registry.register(QUEUE_NAMES.dataExport, worker);
    registry.unregister(QUEUE_NAMES.dataExport);

    publish({ [EnvKey.QUEUE_DATA_EXPORT_CONCURRENCY]: 7 });

    expect(worker.concurrency).toBe(1);
    registry.onModuleDestroy();
  });

  it('falls back when no runtime config is injected', () => {
    const registry = new QueueRuntimeRegistry();

    expect(registry.readConcurrency(QUEUE_NAMES.cron, 2)).toBe(2);
    const worker = fakeWorker(3);
    registry.register(QUEUE_NAMES.cron, worker);
    expect(worker.concurrency).toBe(3);
  });
});
