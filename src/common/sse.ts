import type { Response } from 'express';

export type SseEventName = 'summary' | 'chunk' | 'result' | 'error' | 'done';

export interface SseMessage<T = unknown> {
  event: SseEventName;
  data: T;
}

export function prepareSse(response: Response): void {
  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();
}

export function writeSseEvent<T>(
  response: Response,
  message: SseMessage<T>,
): void {
  response.write(`event: ${message.event}\n`);
  response.write(`data: ${JSON.stringify(message.data)}\n\n`);
}

export function endSse(response: Response): void {
  response.end();
}
