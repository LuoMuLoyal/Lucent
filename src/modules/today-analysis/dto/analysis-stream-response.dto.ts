import { z } from 'zod';
import type { SseProblemDetailsDto } from '../../../common/index.js';
import type { TodayAnalysisDataDto } from './analysis-response.dto.js';

/**
 * Standard Schema (zod 4) for the JSON payload of an SSE `summary` frame.
 * Replaces the former `TodayAnalysisStreamSummaryDto` response class. The
 * HTTP body of `POST /today-analysis/generate/stream` itself is
 * `text/event-stream`, so this schema is documentation/typing only and is
 * never used for outbound serialization.
 */
export const todayAnalysisStreamSummarySchema = z.object({
  summary: z.string(),
});

/** Strongly typed JSON payload of an SSE `summary` frame. */
export type TodayAnalysisStreamSummaryDto = z.infer<
  typeof todayAnalysisStreamSummarySchema
>;

/**
 * JSON payload of an SSE `error` frame: the shared Sse Problem Details shape
 * emitted over an established stream. Kept as a type-only export of the
 * shared common response type (no zod duplication).
 */
export type TodayAnalysisStreamErrorDto = SseProblemDetailsDto;

/**
 * Parsed SSE event frame of `POST /today-analysis/generate/stream`.
 * Documentation/typing only: the HTTP body is `text/event-stream`, not JSON,
 * so the former `TodayAnalysisStreamResultDto` response class stays a plain
 * type alias describing the parsed `data` variants:
 * event=summary => TodayAnalysisStreamSummaryDto; event=result =>
 * TodayAnalysisDataDto; event=error => TodayAnalysisStreamErrorDto;
 * event=done => {}.
 */
export type TodayAnalysisStreamResultDto = {
  event: 'summary' | 'result' | 'error' | 'done';
  data:
    | TodayAnalysisStreamSummaryDto
    | TodayAnalysisDataDto
    | TodayAnalysisStreamErrorDto
    | Record<string, never>;
};
