/**
 * Winston transport for VictoriaLogs HTTP ingestion.
 *
 * Sends newline-delimited JSON (JSON Lines) to the VictoriaLogs
 * `/insert/jsonline` endpoint. Buffers log entries in memory and flushes
 * on either `batchCount` or `batchIntervalMs`, whichever comes first.
 *
 * Fire-and-forget: HTTP errors are emitted as `warn` events on the
 * transport stream — they never block the application or throw.
 */

import { request, type RequestOptions } from 'node:http';
import { type EventEmitter } from 'node:events';
import { URL } from 'node:url';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment */

const TransportStream = require('winston-transport');
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment */

interface VictoriaLogsTransportOptions {
  /** Full ingest URL, e.g. http://victorialogs:9428/insert/jsonline */
  url: string;
  /** Max entries before a forced flush. Default: 100. */
  batchCount?: number;
  /** Auto-flush interval in ms. Default: 5000. */
  batchIntervalMs?: number;
  /** Per-request timeout in ms. Default: 10000. */
  timeoutMs?: number;
  /** Minimum log level. Default: undefined (inherits logger level). */
  level?: string;
  /** Whether to handle uncaught exceptions. Default: false. */
  handleExceptions?: boolean;
}

/**
 * Custom Winston transport that ships log entries to VictoriaLogs.
 *
 * Each log entry is JSON-serialised and appended with `\n` — exactly what
 * VictoriaLogs' `/insert/jsonline` endpoint expects. Entries are batched
 * to avoid one HTTP request per log line.
 */
export class VictoriaLogsTransport extends TransportStream {
  private readonly endpoint: URL;
  private readonly maxBatch: number;
  private readonly flushInterval: number;
  private readonly timeoutMs: number;
  private buffer: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: VictoriaLogsTransportOptions) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    super(opts);
    this.endpoint = new URL(opts.url);
    this.maxBatch = opts.batchCount ?? 100;
    this.flushInterval = opts.batchIntervalMs ?? 5000;
    this.timeoutMs = opts.timeoutMs ?? 10000;
  }

  log(info: object, callback: () => void): void {
    // Serialise to a single-line JSON string (no trailing newline).
    const line = JSON.stringify(info);
    this.buffer.push(line);

    if (this.buffer.length >= this.maxBatch) {
      this.flush();
    } else if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.flush();
      }, this.flushInterval);
    }

    // Fire-and-forget: invoke the callback immediately.
    setImmediate(callback);
  }

  /**
   * Flush the current buffer to VictoriaLogs. Errors are silently
   * swallowed — log shipping is best-effort and must never block
   * the application.
   */
  private flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.buffer.length === 0) return;

    const body = this.buffer.join('\n') + '\n';
    this.buffer = [];

    const options: RequestOptions = {
      method: 'POST',
      hostname: this.endpoint.hostname,
      port: this.endpoint.port,
      path: this.endpoint.pathname + this.endpoint.search,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Length': Buffer.byteLength(body).toString(),
      },
      timeout: this.timeoutMs,
    };

    const emitter = this as unknown as EventEmitter;

    const req = request(options, (res) => {
      // Drain the response to free the socket.
      res.resume();
      if (res.statusCode && res.statusCode >= 400) {
        emitter.emit(
          'warn',
          new Error(`VictoriaLogs ingest returned ${String(res.statusCode)}`),
        );
      }
    });

    req.on('error', (err) => {
      emitter.emit('warn', err);
    });

    req.on('timeout', () => {
      req.destroy(new Error('VictoriaLogs ingest timed out'));
    });

    req.end(body);
  }

  /**
   * Flush remaining entries on close (graceful shutdown).
   */
  close(): void {
    this.flush();
  }
}
