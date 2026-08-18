import type { DailyRecordKind } from '#generated/prisma/client';
import type { AssistantReadConfidence } from '../../types/assistant.types';

// ---------------------------------------------------------------------------
// Numerical constants
// ---------------------------------------------------------------------------

/** Default lookback range for assistant date-range reads. */
export const DEFAULT_RANGE_DAYS = 7;

/** Hard cap for assistant date-range reads to avoid oversized context windows. */
export const MAX_RANGE_DAYS = 14;

/** Default number of recent user messages kept in the assistant prompt context. */
export const DEFAULT_HISTORY_LIMIT = 10;

/** Default offset for proposal target dates (0 = today). */
export const DEFAULT_PROPOSAL_DATE_OFFSET_DAYS = 0;

/** Time-to-live for cached assistant proposals before they expire. */
export const PROPOSAL_TTL_MINUTES = 15;

/** Default page size for assistant vector retrieval tools. */
export const ASSISTANT_VECTOR_DEFAULT_LIMIT = 4;

/** Maximum page size for assistant vector retrieval tools. */
export const ASSISTANT_VECTOR_MAX_LIMIT = 8;

/**
 * Hard cap for medical Q&A corpus retrieval (5 evidence items per page).
 * Kept below the generic vector max so the open low-trust corpus never
 * out-ranks the citability layering; leaflet/DrugBank tools are unaffected.
 */
export const MEDICAL_QA_MAX_LIMIT = 5;

/** Maximum number of recent conversations returned by the assistant conversation list. */
export const RECENT_CONVERSATION_LIMIT = 20;

/** Maximum compact text length before truncation in assistant tool outputs. */
export const MAX_COMPACT_LENGTH = 48;

/** Maximum number of tool execution loops allowed in the assistant runtime graph. */
export const MAX_TOOL_LOOPS = 3;

/**
 * Daily record kinds the assistant write path can create (F-16). Mirrors the
 * union of `AssistantCreateDailyRecordProposalPayload.draft.kind`: the
 * candidate generator may emit exactly these kinds, and the server-side write
 * path (`DailyRecordKind` enum) accepts them. Any candidate kind outside this
 * list is rejected at generation time instead of being silently downgraded.
 */
export const ASSISTANT_CREATE_RECORD_KINDS = [
  'water',
  'meal',
  'symptom',
  'note',
  'sleep',
  'vital',
  'activity',
] as const;

/** Per-tool execution timeout before a tool result is replaced with a timeout envelope (F-6). */
export const TOOL_EXECUTION_TIMEOUT_MS = 20_000;

/** Scoring weights used when ranking daily-record mutation targets. */
export const MUTATION_MATCH_WEIGHTS = {
  kind: 10,
  value: 8,
  title: 9,
  note: 9,
  positionBonus: 3,
} as const;

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
  kind: DailyRecordKind;
  occurredAt: string;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  tags: string[];
  payload: Record<string, unknown> | null;
  mealAnalysisStatus?: string | null;
  mealAnalysisCoverage?: string | null;
  mealAnalysisUpdatedAt?: string | null;
  mealAnalysisFailureReason?: string | null;
  mealShortDescription?: string | null;
  mealTopFoods?: string[];
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
