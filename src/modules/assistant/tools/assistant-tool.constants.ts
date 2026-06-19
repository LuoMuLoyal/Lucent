import type { AssistantReadConfidence } from '../assistant.types';

// ---------------------------------------------------------------------------
// Numerical constants
// ---------------------------------------------------------------------------

export const DEFAULT_RANGE_DAYS = 7;
export const MAX_RANGE_DAYS = 14;
export const DEFAULT_HISTORY_LIMIT = 10;
export const DEFAULT_PROPOSAL_DATE_OFFSET_DAYS = 0;
export const PROPOSAL_TTL_MINUTES = 15;

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------

export const REQUEST_RANGE_CAP_MESSAGE = (
  requestedDays: number,
  maxRangeDays: number,
) =>
  `Requested ${String(requestedDays)} days, but range reads are capped at ${String(maxRangeDays)} days.`;

export const DEFAULT_RANGE_FALLBACK_MESSAGE = (defaultRangeDays: number) =>
  `No explicit range detected, so the lookup defaulted to the last ${String(defaultRangeDays)} days.`;

export const RANGE_TRUNCATED_MESSAGE = (maxRangeDays: number) =>
  `Requested range exceeded ${String(maxRangeDays)} days and was truncated.`;

// ---------------------------------------------------------------------------
// Shared domain types
// ---------------------------------------------------------------------------

export type ToolDateRange = {
  startDate: string;
  endDate: string;
};

export type ToolRecordItem = {
  id: string;
  kind: string;
  occurredAt: string;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  tags: string[];
  payload: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ToolSingleDateResolution = {
  date: string;
  matchedBy: string[];
  ambiguities: string[];
};

export type ToolRangeResolution = ToolDateRange & {
  matchedBy: string[];
  ambiguities: string[];
  truncated: boolean;
  requestedDays: number | null;
};

export type ToolMutationHints = {
  kindHint: string | null;
  numericHint: string | null;
  titleHint: string | null;
  noteHint: string | null;
};

export type ToolMutationRankedRecord = {
  record: ToolRecordItem;
  score: number;
  matchedBy: string[];
};

export type ToolMutationTargetMatch = {
  date: string;
  record: ToolRecordItem | null;
  matchedBy: string[];
  ambiguities: string[];
  reason: string;
  confidence: AssistantReadConfidence;
  candidateCount: number;
};
