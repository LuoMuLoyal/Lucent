import { createServer, type Server } from 'node:net';
import type { Logger } from '@nestjs/common';
import type * as NacosSdk from 'nacos-sdk-rust-binding-node';
import type {
  ClientOptions,
  NacosConfigClient,
} from 'nacos-sdk-rust-binding-node';
import type { Mock } from 'vitest';
import {
  probeTcpReachable,
  RnacosConfigSource,
  type RnacosConnectionOptions,
} from './rnacos-config-source.js';
import type { RuntimeConfigDocument } from './runtime-config-source.js';

type NacosSdkModule = typeof NacosSdk;

const OPTIONS: RnacosConnectionOptions = {
  serverAddr: '127.0.0.1:8848',
  namespace: 'lucent-test',
  group: 'LUCENT_RUNTIME',
  dataId: 'lucent-runtime-tuning.txt',
  username: 'nacos',
  password: 's3cr3t-password',
  requestTimeoutMs: 50,
};

interface FakeSdk {
  readonly module: NacosSdkModule;
  readonly getConfig: Mock;
  readonly addListener: Mock;
  readonly capturedOptions: () => ClientOptions | undefined;
}

/** Fake binding: no native code and no server, but the same call shapes. */
function createFakeSdk(
  config: {
    readonly getConfig?: () => Promise<string>;
    readonly addListener?: () => Promise<void>;
    readonly constructError?: string;
  } = {},
): FakeSdk {
  let captured: ClientOptions | undefined;
  const getConfig = vi.fn(
    config.getConfig ?? ((): Promise<string> => Promise.resolve('')),
  );
  const addListener = vi.fn(
    config.addListener ?? ((): Promise<void> => Promise.resolve()),
  );

  class FakeNacosConfigClient {
    readonly getConfig = getConfig;
    readonly addListener = addListener;

    constructor(options: ClientOptions) {
      if (config.constructError !== undefined) {
        throw new Error(config.constructError);
      }
      captured = options;
    }
  }

  return {
    module: {
      NacosConfigClient:
        FakeNacosConfigClient as unknown as typeof NacosConfigClient,
    } as unknown as NacosSdkModule,
    getConfig,
    addListener,
    capturedOptions: () => captured,
  };
}

function createLogger(): { logger: Logger; warn: Mock; error: Mock } {
  const warn = vi.fn();
  const error = vi.fn();
  return {
    logger: { warn, error } as unknown as Logger,
    warn,
    error,
  };
}

function createSource(
  sdk: FakeSdk,
  overrides: {
    readonly probe?: (
      serverAddr: string,
      timeoutMs: number,
    ) => Promise<boolean>;
    readonly logger?: Logger;
  } = {},
): RnacosConfigSource {
  return new RnacosConfigSource(OPTIONS, {
    loadModule: () => Promise.resolve(sdk.module),
    probe: overrides.probe ?? ((): Promise<boolean> => Promise.resolve(true)),
    probeTimeoutMs: 20,
    ...(overrides.logger === undefined ? {} : { logger: overrides.logger }),
  });
}

describe('RnacosConfigSource', () => {
  describe('load', () => {
    it('returns the document with origin remote and keeps the cache-at-start flag on', async () => {
      const sdk = createFakeSdk({
        getConfig: () => Promise.resolve('THROTTLE_LIMIT=200\n'),
      });
      const source = createSource(sdk);

      const outcome = await source.load();

      expect(outcome).toEqual({
        ok: true,
        document: {
          content: 'THROTTLE_LIMIT=200\n',
          origin: 'remote',
        },
      });
      expect(sdk.capturedOptions()).toEqual({
        serverAddr: '127.0.0.1:8848',
        namespace: 'lucent-test',
        username: 'nacos',
        password: 's3cr3t-password',
        appName: 'lucent',
        configLoadCacheAtStart: true,
      });
    });

    it('marks a document read while the center is unreachable as local-cache', async () => {
      const sdk = createFakeSdk({
        getConfig: () => Promise.resolve('THROTTLE_LIMIT=200\n'),
      });
      const { logger, warn } = createLogger();
      const source = createSource(sdk, {
        probe: () => Promise.resolve(false),
        logger,
      });

      const outcome = await source.load();

      expect(outcome).toEqual({
        ok: true,
        document: { content: 'THROTTLE_LIMIT=200\n', origin: 'local-cache' },
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('source=local-cache');
    });

    it('treats a missing dataId as "no document"', async () => {
      const sdk = createFakeSdk({
        getConfig: () =>
          Promise.reject(
            new Error(
              'config data not exist, error_code=300, data_id=lucent-runtime-tuning.txt',
            ),
          ),
      });

      await expect(createSource(sdk).load()).resolves.toEqual({
        ok: true,
        document: null,
      });
    });

    it('reports other failures without throwing and never echoes the password', async () => {
      const sdk = createFakeSdk({
        getConfig: () =>
          Promise.reject(
            new Error(
              'login failed for nacos with s3cr3t-password, error_code=403',
            ),
          ),
      });
      const { logger, warn } = createLogger();

      const outcome = await createSource(sdk, { logger }).load();

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? null : outcome.reason).toBe('unknown');
      const message = outcome.ok ? '' : outcome.message;
      expect(message).not.toContain('s3cr3t-password');
      expect(message).toContain('***');
      expect(warn).not.toHaveBeenCalled();
    });

    it('folds a synchronous constructor failure into the same failure shape', async () => {
      const sdk = createFakeSdk({
        constructError: 'connection refused: password s3cr3t-password rejected',
      });

      const outcome = await createSource(sdk).load();

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? null : outcome.reason).toBe('unreachable');
      expect(outcome.ok ? '' : outcome.message).not.toContain(
        's3cr3t-password',
      );
    });

    it('gives up on a call that never answers', async () => {
      const sdk = createFakeSdk({
        getConfig: () => new Promise<string>(() => undefined),
      });

      const outcome = await createSource(sdk).load();

      expect(outcome).toEqual({
        ok: false,
        reason: 'unreachable',
        message: 'getConfig did not answer within 50 ms',
      });
    });

    it('does not call the center again after close', async () => {
      const sdk = createFakeSdk();
      const source = createSource(sdk);

      await source.close();
      const outcome = await source.load();

      expect(outcome).toEqual({
        ok: false,
        reason: 'closed',
        message: 'source is closed',
      });
      expect(sdk.getConfig).not.toHaveBeenCalled();
    });
  });

  describe('watch', () => {
    it('forwards pushed documents to the callback', async () => {
      const sdk = createFakeSdk();
      const source = createSource(sdk);
      const received: RuntimeConfigDocument[] = [];

      const watching = await source.watch((document) => {
        received.push(document);
      });
      expect(watching.ok).toBe(true);

      const listener = sdk.addListener.mock.calls[0]?.[2] as (
        error: Error | null,
        response?: { content: string },
      ) => void;
      listener(null, { content: 'THROTTLE_LIMIT=150\n' });

      expect(received).toEqual([
        { content: 'THROTTLE_LIMIT=150\n', origin: 'remote' },
      ]);
    });

    it('stops dispatching once the returned function is called', async () => {
      const sdk = createFakeSdk();
      const received: RuntimeConfigDocument[] = [];
      const watching = await createSource(sdk).watch((document) => {
        received.push(document);
      });
      const listener = sdk.addListener.mock.calls[0]?.[2] as (
        error: Error | null,
        response?: { content: string },
      ) => void;

      if (watching.ok) {
        watching.stop();
      }
      listener(null, { content: 'THROTTLE_LIMIT=150\n' });

      expect(received).toEqual([]);
    });

    it('logs a listener error without dispatching and without leaking secrets', async () => {
      const sdk = createFakeSdk();
      const { logger, warn } = createLogger();
      const received: RuntimeConfigDocument[] = [];

      await createSource(sdk, { logger }).watch((document) => {
        received.push(document);
      });
      const listener = sdk.addListener.mock.calls[0]?.[2] as (
        error: Error | null,
        response?: { content: string },
      ) => void;
      listener(new Error('token=abc123 rejected for s3cr3t-password'));

      expect(received).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = String(warn.mock.calls[0]?.[0]);
      expect(logged).not.toContain('s3cr3t-password');
      expect(logged).not.toContain('abc123');
    });

    it('reports a rejected subscription instead of throwing', async () => {
      const sdk = createFakeSdk({
        addListener: () => Promise.reject(new Error('grpc stream closed')),
      });

      const outcome = await createSource(sdk).watch(() => undefined);

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? '' : outcome.message).toContain('grpc stream closed');
    });
  });

  describe('close', () => {
    it('is local only and safe to call twice', async () => {
      const sdk = createFakeSdk();
      const source = createSource(sdk);

      await source.load();
      await source.close();
      await expect(source.close()).resolves.toBeUndefined();

      expect(sdk.capturedOptions()).toBeDefined();
    });
  });
});

describe('probeTcpReachable', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (server === undefined) {
        resolve();
        return;
      }
      server.close(() => {
        resolve();
      });
    });
    server = undefined;
  });

  it('sees a listening socket and a closed port for what they are', async () => {
    const reachable = createServer();
    server = reachable;
    await new Promise<void>((resolve) => {
      reachable.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const address = reachable.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;

    await expect(
      probeTcpReachable(`127.0.0.1:${String(port)}`, 500),
    ).resolves.toBe(true);

    await new Promise<void>((resolve) => {
      reachable.close(() => {
        resolve();
      });
    });
    server = undefined;

    await expect(
      probeTcpReachable(`127.0.0.1:${String(port)}`, 500),
    ).resolves.toBe(false);
  });

  it('treats a malformed address as unreachable', async () => {
    await expect(probeTcpReachable('not-an-address', 50)).resolves.toBe(false);
  });
});
