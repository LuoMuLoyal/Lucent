import type { ServerResponse } from 'node:http';

/** Named event types used by Server-Sent Event streams. */
export type SseEventName = 'summary' | 'chunk' | 'result' | 'error' | 'done';

/** A single Server-Sent Event message. */
export interface SseMessage<T = unknown> {
  event: SseEventName;
  data: T;
}

/** Prepares a raw Node.js response for Server-Sent Events. */
export function prepareSse(response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

/** Writes a single event to an SSE stream. */
export function writeSseEvent<T>(
  response: ServerResponse,
  message: SseMessage<T>,
): void {
  response.write(`event: ${message.event}\n`);
  response.write(`data: ${JSON.stringify(message.data)}\n\n`);
}

/** Ends an SSE stream gracefully. */
export function endSse(response: ServerResponse): void {
  response.end();
}
