import { z } from 'zod';
import type { SseProblemDetailsDto } from '../../../../../common/index.js';
import type { AnalysisDataDto } from './analysis-response.js';

/**
 * Standard Schema (zod 4) for the JSON payload of an SSE `summary` frame.
 * Replaces the former `AnalysisStreamSummaryDto` response class. The
 * HTTP body of `POST /analysis/generate/stream` itself is
 * `text/event-stream`, so this schema is documentation/typing only and is
 * never used for outbound serialization.
 */
export const analysisStreamSummarySchema = z.object({
  summary: z.string(),
});

/** Strongly typed JSON payload of an SSE `summary` frame. */
export type AnalysisStreamSummaryDto = z.infer<
  typeof analysisStreamSummarySchema
>;

/**
 * JSON payload of an SSE `error` frame: the shared Sse Problem Details shape
 * emitted over an established stream. Kept as a type-only export of the
 * shared common response type (no zod duplication).
 */
export type AnalysisStreamErrorDto = SseProblemDetailsDto;

/**
 * Parsed SSE event frame of `POST /analysis/generate/stream`.
 * Documentation/typing only: the HTTP body is `text/event-stream`, not JSON,
 * so the former `AnalysisStreamResultDto` response class stays a plain
 * type alias describing the parsed `data` variants:
 * event=summary => AnalysisStreamSummaryDto; event=result =>
 * AnalysisDataDto; event=error => AnalysisStreamErrorDto;
 * event=done => {}.
 */
export type AnalysisStreamResultDto = {
  event: 'summary' | 'result' | 'error' | 'done';
  data:
    | AnalysisStreamSummaryDto
    | AnalysisDataDto
    | AnalysisStreamErrorDto
    | Record<string, never>;
};
