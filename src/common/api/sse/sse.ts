import type { ServerResponse } from 'node:http';

/** Named event types used by Server-Sent Event streams. */
export type SseEventName = 'summary' | 'chunk' | 'result' | 'error' | 'done';

/** A single Server-Sent Event message. */
export interface SseMessage<T = unknown> {
  event: SseEventName;
  data: T;
}

/**
 * Minimal connection-tracking contract accepted by the SSE helpers.
 * Implemented by `SseConnectionRegistry`; kept as a local interface so the
 * helpers stay free of dependency-injection concerns.
 */
export interface SseConnectionTracker {
  register(response: ServerResponse): void;
  unregister(response: ServerResponse): void;
}

/**
 * Prepares a raw Node.js response for Server-Sent Events.
 * When a tracker is given, the connection is registered so the server can
 * notify and close it gracefully on shutdown.
 */
export function prepareSse(
  response: ServerResponse,
  tracker?: SseConnectionTracker,
): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  tracker?.register(response);
}

/**
 * Writes a single event to an SSE stream. Writes are skipped once the
 * response has ended or been destroyed (e.g. after a shutdown-triggered
 * close) so a late producer cannot crash the process with a
 * write-after-end error.
 */
export function writeSseEvent<T>(
  response: ServerResponse,
  message: SseMessage<T>,
): void {
  if (response.writableEnded || response.destroyed) {
    return;
  }
  response.write(`event: ${message.event}\n`);
  response.write(`data: ${JSON.stringify(message.data)}\n\n`);
}

/**
 * Ends an SSE stream gracefully, unregistering it from the tracker first so
 * shutdown logic never touches a finished connection.
 */
export function endSse(
  response: ServerResponse,
  tracker?: SseConnectionTracker,
): void {
  tracker?.unregister(response);
  if (!response.writableEnded) {
    response.end();
  }
}
