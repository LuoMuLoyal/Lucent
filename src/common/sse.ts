import type { Response } from 'express';

/** Named event types used by Server-Sent Event streams. */
export type SseEventName = 'summary' | 'chunk' | 'result' | 'error' | 'done';

/** A single Server-Sent Event message. */
export interface SseMessage<T = unknown> {
  event: SseEventName;
  data: T;
}

/** Prepares an Express response for Server-Sent Events. */
export function prepareSse(response: Response): void {
  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();
}

/** Writes a single event to an SSE stream. */
export function writeSseEvent<T>(
  response: Response,
  message: SseMessage<T>,
): void {
  response.write(`event: ${message.event}\n`);
  response.write(`data: ${JSON.stringify(message.data)}\n\n`);
}

/** Ends an SSE stream gracefully. */
export function endSse(response: Response): void {
  response.end();
}
