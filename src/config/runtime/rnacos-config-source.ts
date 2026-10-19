/**
 * rnacos adapter: the only file in the codebase that touches the native Nacos
 * binding.
 *
 * Everything here is shaped by what the local spike measured (plan §4):
 *
 * - `serverAddr` takes the **HTTP** port (8848); the SDK logs in over HTTP and
 *   then connects to gRPC on `serverAddr + 1000`.
 * - The binding's constructor throws **synchronously** when the server is
 *   unreachable or the credentials are wrong, so client creation is wrapped and
 *   folded into the same failure path as a rejected call.
 * - `getConfig` rejects with `error_code=300 … config data not exist` when
 *   nothing is published; that is "no document", not an error.
 * - `configLoadCacheAtStart` is always `true`: a restart while the center is
 *   down keeps the last cached document instead of falling back to the
 *   environment. The cache cannot prove its own freshness, so a cheap TCP probe
 *   decides whether the snapshot is reported as `remote` or `local-cache`.
 * - The binding exposes no `close()`: long connections last for the process
 *   lifetime. `close()` therefore only releases local state.
 * - The SDK is imported lazily. `RNACOS_ENABLED` unset means this module is
 *   loaded but no native code is (plan §12, Task 10).
 */

import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import { Logger } from '@nestjs/common';
import type * as NacosSdk from 'nacos-sdk-rust-binding-node';
import type {
  ClientOptions,
  NacosConfigClient,
  NacosConfigResponse,
} from 'nacos-sdk-rust-binding-node';
import type {
  RuntimeConfigDocument,
  RuntimeConfigDocumentSource,
  RuntimeConfigLoadOutcome,
  RuntimeConfigSourceFailure,
  RuntimeConfigWatchOutcome,
} from './runtime-config-source.js';

/** Shape of the lazily loaded binding. Type-only: nothing is required eagerly. */
type NacosSdkModule = typeof NacosSdk;

/** Connection settings, read once from the environment by the factory. */
export interface RnacosConnectionOptions {
  readonly serverAddr: string;
  readonly namespace: string;
  readonly group: string;
  readonly dataId: string;
  readonly username: string;
  readonly password: string;
  /**
   * Bounds the first `getConfig` and the listener registration — the binding
   * has no timeout parameter of its own, so a hung call would otherwise block
   * bootstrap forever (plan §5, Step 4).
   */
  readonly requestTimeoutMs: number;
}

/** Collaborators a test replaces; production uses the defaults. */
export interface RnacosConfigSourceDeps {
  readonly loadModule?: () => Promise<NacosSdkModule>;
  readonly probe?: (serverAddr: string, timeoutMs: number) => Promise<boolean>;
  readonly probeTimeoutMs?: number;
  readonly logger?: Logger;
}

/** The readiness probe is meant to be cheap; a second is plenty. */
const DEFAULT_PROBE_TIMEOUT_MS = 1_000;

/** `<host>:<port>`, the format `RNACOS_SERVER_ADDR` is validated against. */
const ADDRESS_PATTERN = /^(?<host>.+):(?<port>\d{1,5})$/u;

const MISSING_CONFIG_PATTERN = /error_code\s*[:=]?\s*300\b/u;

type Settled<T> =
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'rejected'; readonly error: unknown }
  | { readonly status: 'timeout' };

/**
 * Races a binding call against a timer. Both callbacks are handled, so a call
 * that rejects after the timeout has already won cannot surface as an unhandled
 * rejection.
 */
function settle<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<Settled<T>> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve({ status: 'timeout' });
    }, timeoutMs);
  });

  const guarded = promise.then<Settled<T>, Settled<T>>(
    (value) => ({ status: 'fulfilled', value }),
    (error: unknown) => ({ status: 'rejected', error }),
  );

  return Promise.race([guarded, timedOut]).finally(() => {
    clearTimeout(timer);
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Opens a TCP connection to the configured address. Used only to tell "the
 * center answered" apart from "the document came from the local cache".
 */
export async function probeTcpReachable(
  serverAddr: string,
  timeoutMs: number,
): Promise<boolean> {
  const match = ADDRESS_PATTERN.exec(serverAddr.trim());
  if (match?.groups === undefined) {
    return false;
  }
  const { host, port } = match.groups;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const socket = createConnection({ host, port: Number(port) });
    const finish = (reachable: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(reachable);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      finish(true);
    });
    socket.once('timeout', () => {
      finish(false);
    });
    socket.once('error', () => {
      finish(false);
    });
  });
}

/**
 * Loads the binding. The package ships CommonJS with static named exports,
 * which Node 26 imports directly (plan §4.2); `createRequire` is kept as the
 * fallback for a build where that stops holding.
 */
const logger = new Logger('NacosSdkImport');

async function importNacosSdk(): Promise<NacosSdkModule> {
  try {
    return await import('nacos-sdk-rust-binding-node');
  } catch (error) {
    // Fallback for a build where the package's static named exports stop
    // resolving; if this path fails too, its own error is what the caller
    // reports (plan §4.2).
    logger.warn(
      `ESM import failed, retrying through createRequire: ${messageOf(error)}`,
    );
    const require = createRequire(import.meta.url);
    return require('nacos-sdk-rust-binding-node') as NacosSdkModule;
  }
}

export class RnacosConfigSource implements RuntimeConfigDocumentSource {
  private readonly logger: Logger;
  private readonly loadModule: () => Promise<NacosSdkModule>;
  private readonly probe: (
    serverAddr: string,
    timeoutMs: number,
  ) => Promise<boolean>;
  private readonly probeTimeoutMs: number;
  private client: NacosConfigClient | null = null;
  private closed = false;

  constructor(
    private readonly options: RnacosConnectionOptions,
    deps: RnacosConfigSourceDeps = {},
  ) {
    this.logger = deps.logger ?? new Logger(RnacosConfigSource.name);
    this.loadModule = deps.loadModule ?? importNacosSdk;
    this.probe = deps.probe ?? probeTcpReachable;
    this.probeTimeoutMs = deps.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  }

  async load(): Promise<RuntimeConfigLoadOutcome> {
    const acquired = await this.acquireClient();
    if (!acquired.ok) {
      return acquired;
    }

    const settled = await settle(
      acquired.client.getConfig(this.options.dataId, this.options.group),
      this.options.requestTimeoutMs,
    );

    if (settled.status === 'rejected') {
      const message = this.redact(messageOf(settled.error));
      if (MISSING_CONFIG_PATTERN.test(message)) {
        // Not an error: nothing is published at this dataId yet.
        return { ok: true, document: null };
      }
      return { ok: false, reason: 'unknown', message };
    }
    if (settled.status === 'timeout') {
      return {
        ok: false,
        reason: 'unreachable',
        message: `getConfig did not answer within ${String(
          this.options.requestTimeoutMs,
        )} ms`,
      };
    }

    const reachable = await this.probe(
      this.options.serverAddr,
      this.probeTimeoutMs,
    );
    if (!reachable) {
      this.logger.warn(
        'rnacos did not answer the readiness probe; applying the cached document (source=local-cache)',
      );
    }

    return {
      ok: true,
      document: {
        content: settled.value,
        origin: reachable ? 'remote' : 'local-cache',
      },
    };
  }

  async watch(
    onDocument: (document: RuntimeConfigDocument) => void,
  ): Promise<RuntimeConfigWatchOutcome> {
    const acquired = await this.acquireClient();
    if (!acquired.ok) {
      return acquired;
    }

    let stopped = false;
    const listener = (
      error: Error | null,
      response?: NacosConfigResponse,
    ): void => {
      if (stopped || this.closed) {
        return;
      }
      if (error !== null) {
        const message = this.redact(messageOf(error));
        this.logger.warn(
          MISSING_CONFIG_PATTERN.test(message)
            ? `${this.options.dataId} was removed from the center; the current snapshot stays in force`
            : `rnacos listener error: ${message}`,
        );
        return;
      }
      if (response === undefined || response.content.length === 0) {
        return;
      }
      // A push always comes from the server, so it is never a cached read.
      onDocument({ content: response.content, origin: 'remote' });
    };

    const settled = await settle(
      acquired.client.addListener(
        this.options.dataId,
        this.options.group,
        listener,
      ),
      this.options.requestTimeoutMs,
    );
    if (settled.status !== 'fulfilled') {
      return {
        ok: false,
        reason: settled.status === 'timeout' ? 'unreachable' : 'unknown',
        message: this.redact(
          settled.status === 'rejected'
            ? messageOf(settled.error)
            : `addListener did not answer within ${String(
                this.options.requestTimeoutMs,
              )} ms`,
        ),
      };
    }

    // The binding cannot remove a listener, so cancelling only stops the
    // dispatch into this process (plan §4.5).
    return {
      ok: true,
      stop: () => {
        stopped = true;
      },
    };
  }

  /** Local cleanup only: the binding has no shutdown and no `close` option. */
  close(): Promise<void> {
    this.closed = true;
    this.client = null;
    return Promise.resolve();
  }

  private async acquireClient(): Promise<
    | { readonly ok: true; readonly client: NacosConfigClient }
    | {
        readonly ok: false;
        readonly reason: RuntimeConfigSourceFailure;
        readonly message: string;
      }
  > {
    if (this.closed) {
      return { ok: false, reason: 'closed', message: 'source is closed' };
    }
    if (this.client !== null) {
      return { ok: true, client: this.client };
    }

    try {
      const sdk = await this.loadModule();
      const clientOptions: ClientOptions = {
        serverAddr: this.options.serverAddr,
        namespace: this.options.namespace,
        username: this.options.username,
        password: this.options.password,
        appName: 'lucent',
        // Always on: a restart while the center is down keeps the cached
        // document instead of silently reverting every tuned value (plan §4).
        configLoadCacheAtStart: true,
      };
      this.client = new sdk.NacosConfigClient(clientOptions);
      return { ok: true, client: this.client };
      // eslint-disable-next-line error-handling/no-silent-catch -- folded into the returned failure, which the service logs
    } catch (error) {
      // The constructor can fail synchronously (server down, bad credentials),
      // and the SDK is also what may be missing on an unsupported platform —
      // both land here, and neither may crash the process.
      return {
        ok: false,
        reason: 'unreachable',
        message: this.redact(messageOf(error)),
      };
    }
  }

  /**
   * Removes credentials from anything that reaches a log or an error message.
   * The document itself is never logged, but request errors can echo the token
   * or the login payload.
   */
  private redact(message: string): string {
    let redacted = message;
    for (const secret of [this.options.password, this.options.username]) {
      const trimmed = secret.trim();
      if (trimmed.length > 0) {
        redacted = redacted.split(trimmed).join('***');
      }
    }
    return redacted
      .replace(/(accessToken["'\s:=]+)[^\s,&"'}]+/giu, '$1***')
      .replace(/([Pp]assword["'\s:=]+)[^\s,&"'}]+/gu, '$1***')
      .replace(/(\btoken["'\s:=]+)[^\s,&"'}]+/giu, '$1***');
  }
}
