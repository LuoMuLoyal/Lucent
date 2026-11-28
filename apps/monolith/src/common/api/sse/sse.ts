import type { ServerResponse } from 'node:http';
import type { FastifyReply } from 'fastify';
import { DomainFailureException } from '../../result/domain-failure.exception.js';
import { createDomainFailure } from '../../result/index.js';

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
  register(response: ServerResponse, language?: string): void;
  unregister(response: ServerResponse): void;
}

/**
 * Optional admission-control contract. A tracker that can reject connections
 * implements this so `prepareSse` can refuse **before** writing the 200 head.
 *
 * 顺序很关键：SSE 一旦写下响应头，HTTP 状态就固定为 200，无法再改成 503。
 * 因此准入判定必须发生在 `writeHead` 之前。
 */
export interface SseConnectionAdmission {
  tryRegister(
    response: ServerResponse,
    language?: string,
    userId?: string,
  ):
    | { accepted: true }
    | { accepted: false; reason: 'global_limit' | 'user_limit' };
}

/**
 * Headers already registered on the framework reply (e.g. CORS) that must
 * survive the raw SSE head write. Shape matches Fastify's `reply.getHeaders()`
 * and Node's `OutgoingHttpHeaders`.
 */
export type SseInheritedHeaders = Record<
  string,
  number | string | readonly string[] | undefined
>;

/**
 * Prepares a raw Node.js response for Server-Sent Events.
 * When a tracker is given, the connection is registered so the server can
 * notify and close it gracefully on shutdown.
 *
 * 若 tracker 同时实现 {@link SseConnectionAdmission}，准入判定发生在写响应头
 * **之前**：被拒时返回 `{ ok: false, reason }` 且不写任何字节，调用方据此回
 * 503 Problem Details。这是唯一能给出正确 HTTP 状态的时机 —— 一旦 SSE 头写出，
 * 状态码就固定为 200，只能改用 `event: error` 帧表达失败。
 *
 * Writing the head directly on the raw response bypasses the framework reply
 * pipeline, which is the only place where headers added through
 * `reply.header()` are applied. Callers must therefore forward
 * `reply.getHeaders()` as [inheritedHeaders]; otherwise plugin-registered
 * headers (notably `@fastify/cors`, plus `vary: Origin`) never reach the wire
 * and browsers abort the stream as a CORS failure. SSE protocol headers win
 * when a key collides.
 */
export function prepareSse(
  response: ServerResponse,
  tracker?: SseConnectionTracker,
  language = 'en',
  inheritedHeaders?: SseInheritedHeaders,
  userId?: string,
): SsePrepareResult {
  const admission = asAdmission(tracker);
  if (admission != null) {
    const result = admission.tryRegister(response, language, userId);
    if (!result.accepted) {
      return { ok: false, reason: result.reason };
    }
  }

  response.writeHead(200, {
    ...inheritedHeaders,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // 实现了准入接口的 tracker 已在上面登记；其余 tracker 走旧的登记路径。
  if (admission == null) {
    tracker?.register(response, language);
  }
  return { ok: true };
}

/** `prepareSse` 的结果：被拒时调用方必须回 503。 */
export type SsePrepareResult =
  { ok: true } | { ok: false; reason: 'global_limit' | 'user_limit' };

function asAdmission(
  tracker: SseConnectionTracker | undefined,
): SseConnectionAdmission | undefined {
  if (tracker == null) {
    return undefined;
  }
  const candidate = tracker as unknown as Partial<SseConnectionAdmission>;
  return typeof candidate.tryRegister === 'function'
    ? (tracker as unknown as SseConnectionAdmission)
    : undefined;
}

/**
 * `prepareSse` 的控制器便捷封装：准入失败时直接抛 503 DomainFailure。
 *
 * 抛异常而不是 `return reply.status(503)` 是刻意的：所有 SSE 控制器都声明
 * `@Res()` 且返回 `Promise<void>`，让全局 `ApiExceptionFilter` 统一产出
 * RFC 9457 Problem Details，能保证这个响应的形状与其它 503 完全一致。
 */
export function openSse(
  reply: FastifyReply,
  tracker: SseConnectionTracker,
  language: string,
  userId?: string,
): void {
  const result = prepareSse(
    reply.raw,
    tracker,
    language,
    reply.getHeaders(),
    userId,
  );
  if (!result.ok) {
    throw new DomainFailureException(
      createDomainFailure({
        kind: 'dependency',
        code: 'DEPENDENCY_UNAVAILABLE',
        retryable: true,
        detail:
          'Too many concurrent streams are open. Close some streams and try again.',
      }),
    );
  }
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
