/**
 * Pino destination stream that ships log lines to VictoriaLogs.
 *
 * VictoriaLogs is fed newline-delimited JSON at `/insert/jsonline`. Entries are
 * buffered and flushed on either `batchCount` or `batchIntervalMs`, whichever
 * comes first — one HTTP request per log line would be absurd under load.
 *
 * Fire-and-forget: an ingest failure must never block or throw into the
 * application. Failures surface through `onWarn` so they still reach the
 * application logger instead of being silently swallowed (ADR-0012).
 */

import { request, type RequestOptions } from 'node:http';
import { Writable } from 'node:stream';
import { URL } from 'node:url';

/** Flush once this many entries are buffered, even if the interval has not elapsed. */
const DEFAULT_BATCH_COUNT = 100;
/** Flush interval for low-volume periods (ms). */
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
/** Per-request timeout for the ingest POST (ms). */
const DEFAULT_TIMEOUT_MS = 10_000;
/** First non-2xx status that means VictoriaLogs rejected the batch. */
const HTTP_BAD_REQUEST = 400;

export interface VictoriaLogsStreamOptions {
  /** Full ingest URL, e.g. `http://victorialogs:9428/insert/jsonline`. */
  url: string;
  /** Max buffered entries before a forced flush. Default: 100. */
  batchCount?: number;
  /** Auto-flush interval in ms. Default: 5000. */
  batchIntervalMs?: number;
  /** Per-request timeout in ms. Default: 10000. */
  timeoutMs?: number;
  /** Receives ingest failures. Defaults to a no-op. */
  onWarn?: (message: string) => void;
}

/**
 * Rewrites one pino JSON line into what VictoriaLogs expects.
 *
 * Two fields are mandatory/mapped:
 * - `_msg` — the message body. Without it VictoriaLogs files every entry under
 *   a `missing _msg field` placeholder and collapses them into one empty
 *   stream. We *copy* rather than rename so the same line stays readable for
 *   other consumers.
 * - `_time` — event time. Without it entries are indexed by arrival time, so a
 *   batch flushed 5s late lands 5s late in the timeline.
 *
 * Caller-supplied `_msg` / `_time` always win.
 */
export function toVictoriaLogsLine(
  line: string,
  fallbackTimestamp: () => string,
): string {
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
    // eslint-disable-next-line error-handling/no-silent-catch -- the fallback below IS the handling: the raw line is shipped instead of being discarded
  } catch {
    // Not JSON (should not happen — pino emits NDJSON). Better to forward the
    // raw text than to drop the entry.
    return JSON.stringify({ _msg: line, _time: fallbackTimestamp() });
  }

  if (entry['_msg'] === undefined) {
    entry['_msg'] =
      typeof entry['message'] === 'string' ? entry['message'] : '';
  }
  if (entry['_time'] === undefined) {
    entry['_time'] =
      typeof entry['timestamp'] === 'string'
        ? entry['timestamp']
        : fallbackTimestamp();
  }

  return JSON.stringify(entry);
}

export class VictoriaLogsStream extends Writable {
  private readonly endpoint: URL;
  private readonly maxBatch: number;
  private readonly flushInterval: number;
  private readonly timeoutMs: number;
  private readonly onWarn: (message: string) => void;
  private buffer: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: VictoriaLogsStreamOptions) {
    super({ decodeStrings: false });
    this.endpoint = new URL(opts.url);
    this.maxBatch = opts.batchCount ?? DEFAULT_BATCH_COUNT;
    this.flushInterval = opts.batchIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onWarn = opts.onWarn ?? (() => {});
  }

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const line of text.split('\n')) {
      if (line.length === 0) continue;
      this.buffer.push(
        toVictoriaLogsLine(line, () => new Date().toISOString()),
      );
    }

    if (this.buffer.length >= this.maxBatch) {
      this.flush();
    } else if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.flush();
      }, this.flushInterval);
      // Never keep the process alive just to ship logs.
      this.timer.unref();
    }

    callback();
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.flush();
    callback();
  }

  /** Flush the current buffer. Best-effort: failures are reported, not thrown. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;

    const body = `${this.buffer.join('\n')}\n`;
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

    const req = request(options, (res) => {
      // Drain the response so the socket is released.
      res.resume();
      if (res.statusCode && res.statusCode >= HTTP_BAD_REQUEST) {
        this.onWarn(`VictoriaLogs ingest returned ${String(res.statusCode)}`);
      }
    });

    req.on('error', (err: Error) => {
      this.onWarn(`VictoriaLogs ingest failed: ${err.message}`);
    });
    req.on('timeout', () => {
      req.destroy(new Error('VictoriaLogs ingest timed out'));
    });

    req.end(body);
  }
}
