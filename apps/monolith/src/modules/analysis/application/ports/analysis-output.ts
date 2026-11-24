/**
 * The LLM's structured output for Today Analysis.
 *
 * The zod schema lives in `infrastructure/llm/schemas/analysis.ts` (it is the
 * contract handed to the model adapter), but the *type* is consumed by
 * `application/` — the use case names it and the copy service fills it.
 * `ddd-application-no-infra-or-adapters` forbids that direction, so the type is
 * declared here and the schema re-exports it.
 *
 * Declared mutable to match `z.infer` output.
 */

/** Which advice family a bullet belongs to. */
export type AnalysisBulletKind =
  | 'medication'
  | 'hydration'
  | 'sleep'
  | 'general';

/** One bullet of the analysis. */
export type AnalysisBullet = {
  kind: AnalysisBulletKind;
  text: string;
};

/** What the model returns for a day's analysis. */
export type AnalysisStructuredOutput = {
  summary: string;
  /** Two or three bullets — the schema enforces the bound. */
  bullets: AnalysisBullet[];
  actionLabel: string;
  action: string;
  confidenceNote: string;
};
