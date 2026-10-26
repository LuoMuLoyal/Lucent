import { z } from 'zod';

/**
 * SSE event-frame documentation schemas for
 * `POST /reports/summary/generate/stream`.
 *
 * The HTTP body of the stream endpoint itself is `text/event-stream`, not
 * JSON — these schemas document/type the JSON `data` payloads of the frames
 * only and are never used for outbound serialization. They replace the former
 * `@ApiProperty` response classes `ReportSummaryStreamSummaryDto` /
 * `ReportSummaryStreamResultDto`.
 */
export const reportSummaryStreamSummarySchema = z.object({
  summary: z.string(),
});

/** Strongly typed JSON payload of an SSE `summary` frame. */
export type ReportSummaryStreamSummaryDto = z.infer<
  typeof reportSummaryStreamSummarySchema
>;

/**
 * Parsed SSE event frame of `POST /reports/summary/generate/stream`.
 * Documentation/typing only: event=summary => { summary }, event=result =>
 * ReportSummaryDataDto-like object, event=error => { type, title, detail,
 * code, retryable?, retryAfter?, status }, event=done => {}.
 */
export const reportSummaryStreamResultSchema = z.object({
  event: z.enum(['summary', 'result', 'error', 'done']),
  data: z
    .record(z.string(), z.unknown())
    .describe(
      'SSE payload object. event=summary => { summary }, event=result => ReportSummaryDataDto-like object, event=error => { type, title, detail, code, retryable?, retryAfter?, status }, event=done => {}.',
    ),
});

/** Strongly typed SSE event frame of the report summary stream. */
export type ReportSummaryStreamResultDto = z.infer<
  typeof reportSummaryStreamResultSchema
>;
