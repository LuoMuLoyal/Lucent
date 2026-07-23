import { nowIsoString } from '../../../common/helpers';
import { mealRecordPayloadSchema } from '../../../common/validators/jsonb-schemas';
import { isDeepStrictEqual } from 'node:util';

export const MEAL_ANALYSIS_STATUSES = [
  'analyzing',
  'unconfirmed',
  'confirmed',
  'analysis_failed',
] as const;

export type MealAnalysisStatus = (typeof MEAL_ANALYSIS_STATUSES)[number];

export const MEAL_ANALYSIS_COVERAGES = ['none', 'partial', 'complete'] as const;

export type MealAnalysisCoverage = (typeof MEAL_ANALYSIS_COVERAGES)[number];

export interface MealRecognizedDish {
  dishKey: string;
  rawName: string;
  normalizedDishName: string;
  confidence: number | null;
  portionText: string | null;
  source: 'vision';
}

export interface MealResolvedIngredient {
  dishKey: string;
  ingredientName: string;
  normalizedIngredientName: string;
  defaultRatio: number | null;
  decompositionSource: 'template' | 'model';
  confidence: number | null;
}

export interface MealCompositionMatch {
  dishKey: string;
  ingredientName: string;
  matchedFoodId: string | null;
  matchedFoodName: string | null;
  matchMethod: 'exact' | 'alias' | 'fuzzy' | 'unmatched';
  matchScore: number;
}

export interface MealAnalysisPayload {
  analysisStatus?: MealAnalysisStatus;
  coverage?: MealAnalysisCoverage;
  mealDescription?: string | null;
  foodItems?: Array<Record<string, unknown>>;
  recognizedDishes?: MealRecognizedDish[];
  resolvedIngredients?: MealResolvedIngredient[];
  compositionMatches?: MealCompositionMatch[];
  nutritionEstimate?: Record<string, unknown> | null;
  mealCommentary?: string | null;
  matchDiagnostics?: Record<string, unknown> | null;
  failureReason?: string | null;
  analyzedAt?: string | null;
  confirmedAt?: string | null;
  sourceRevision?: number;
  imageObjectKey?: string | null;
}

export interface MealRecordPayload {
  mealInput?: Record<string, unknown> | null;
  mealAnalysis?: MealAnalysisPayload | null;
  mealAnalysisLastConfirmed?: MealAnalysisPayload | null;
}

export interface MealListSummary {
  mealAnalysisStatus: MealAnalysisStatus | null;
  mealAnalysisCoverage: MealAnalysisCoverage | null;
  mealAnalysisUpdatedAt: string | null;
  mealAnalysisFailureReason: string | null;
  mealShortDescription: string | null;
  mealTopFoods: string[];
}

type PlainRecord = Record<string, unknown>;

export function parseMealRecordPayload(raw: unknown): MealRecordPayload {
  const root = asPlainRecord(raw);
  if (root == null) {
    return {};
  }

  const manuallyParsed: MealRecordPayload = {
    mealInput: clonePlainRecord(readMealInputCandidate(root)),
    mealAnalysis: cloneMealAnalysis(root['mealAnalysis']),
    mealAnalysisLastConfirmed: cloneMealAnalysis(
      root['mealAnalysisLastConfirmed'],
    ),
  };

  // Validate the manually parsed result against the Zod schema.
  // On failure, fall back to the manually parsed version (which is more
  // permissive) so a schema mismatch doesn't crash the request.
  const zodResult = mealRecordPayloadSchema.safeParse(manuallyParsed);
  if (zodResult.success) {
    return zodResult.data as MealRecordPayload;
  }
  return manuallyParsed;
}

export function buildMealPayloadFromClientInput(
  clientPayload: unknown,
  existingPayload: unknown,
): PlainRecord | null {
  const existing = parseMealRecordPayload(existingPayload);
  const clientRoot = asPlainRecord(clientPayload);
  const mealInput = clonePlainRecord(
    clientRoot == null ? null : readMealInputCandidate(clientRoot),
  );

  const nextPayload: MealRecordPayload = {
    ...(mealInput != null ? { mealInput } : {}),
    ...(existing.mealAnalysis != null
      ? { mealAnalysis: existing.mealAnalysis }
      : {}),
    ...(existing.mealAnalysisLastConfirmed != null
      ? { mealAnalysisLastConfirmed: existing.mealAnalysisLastConfirmed }
      : {}),
  };

  return hasKeys(nextPayload as PlainRecord)
    ? (nextPayload as PlainRecord)
    : null;
}

export function markMealAnalysisQueued(
  rawPayload: unknown,
  params: {
    imageObjectKey: string;
  },
): PlainRecord {
  const parsed = parseMealRecordPayload(rawPayload);
  const previousAnalysis = parsed.mealAnalysis ?? null;
  const previousStatus = previousAnalysis?.analysisStatus ?? null;
  const lastConfirmed =
    previousStatus === 'confirmed'
      ? previousAnalysis
      : (parsed.mealAnalysisLastConfirmed ?? null);
  const nextRevision = (previousAnalysis?.sourceRevision ?? 0) + 1;

  return {
    ...(parsed.mealInput != null ? { mealInput: parsed.mealInput } : {}),
    mealAnalysis: {
      ...(previousAnalysis ?? {}),
      analysisStatus: 'analyzing',
      coverage: previousAnalysis?.coverage ?? 'none',
      failureReason: null,
      analyzedAt: null,
      confirmedAt: previousAnalysis?.confirmedAt ?? null,
      sourceRevision: nextRevision,
      imageObjectKey: params.imageObjectKey,
    },
    ...(lastConfirmed != null
      ? { mealAnalysisLastConfirmed: lastConfirmed }
      : {}),
  };
}

export function getMealSourceRevision(rawPayload: unknown): number {
  const parsed = parseMealRecordPayload(rawPayload);
  return parsed.mealAnalysis?.sourceRevision ?? 0;
}

export function getMealListSummary(rawPayload: unknown): MealListSummary {
  const parsed = parseMealRecordPayload(rawPayload);
  const analysis = parsed.mealAnalysis ?? null;
  const topFoods = readMealTopFoods(analysis);

  return {
    mealAnalysisStatus: analysis?.analysisStatus ?? null,
    mealAnalysisCoverage: analysis?.coverage ?? null,
    mealAnalysisUpdatedAt: analysis?.analyzedAt ?? null,
    mealAnalysisFailureReason: normalizeText(analysis?.failureReason),
    mealShortDescription: normalizeText(analysis?.mealDescription),
    mealTopFoods: topFoods,
  };
}

function cloneMealAnalysis(raw: unknown): MealAnalysisPayload | null {
  const record = clonePlainRecord(raw);
  if (record == null) {
    return null;
  }
  return record;
}

function readMealInputCandidate(root: PlainRecord): PlainRecord | null {
  const nested = asPlainRecord(root['mealInput']);
  if (nested != null) {
    return nested;
  }

  const {
    mealAnalysis: _mealAnalysis,
    mealAnalysisLastConfirmed: _last,
    ...rest
  } = root;
  return hasKeys(rest) ? rest : null;
}

function readFoodName(raw: unknown): string | null {
  const item = asPlainRecord(raw);
  if (item == null) {
    return null;
  }

  return (
    normalizeText(item['displayName']) ??
    normalizeText(item['matchedFoodName']) ??
    normalizeText(item['canonicalName']) ??
    normalizeText(item['name'])
  );
}

function clonePlainRecord(raw: unknown): PlainRecord | null {
  const record = asPlainRecord(raw);
  if (record == null) {
    return null;
  }

  return JSON.parse(JSON.stringify(record)) as PlainRecord;
}

function asPlainRecord(raw: unknown): PlainRecord | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  return raw as PlainRecord;
}

function hasKeys(record: PlainRecord): boolean {
  return Object.keys(record).length > 0;
}

function normalizeText(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readMealTopFoods(analysis: MealAnalysisPayload | null): string[] {
  const recognizedDishNames = Array.isArray(analysis?.recognizedDishes)
    ? analysis.recognizedDishes
        .map((item) => normalizeText(item.rawName) || item.normalizedDishName)
        .slice(0, 3)
    : [];
  if (recognizedDishNames.length > 0) {
    return recognizedDishNames;
  }

  return Array.isArray(analysis?.foodItems)
    ? analysis.foodItems
        .map((item) => readFoodName(item))
        .filter((value): value is string => value != null)
        .slice(0, 3)
    : [];
}

export function normalizeMealEntityName(
  raw: string | null | undefined,
): string | null {
  const text = normalizeText(raw);
  if (text == null) {
    return null;
  }

  return text
    .replace(/\s+/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[、，,]/g, '')
    .trim();
}

export function isMealAnalysisConfirmRequest(rawPayload: unknown): boolean {
  const root = asPlainRecord(rawPayload);
  const analysis = asPlainRecord(root?.['mealAnalysis']);
  return analysis?.['analysisStatus'] === 'confirmed';
}

export function hasMealDishInputChanges(
  nextPayload: unknown,
  existingPayload: unknown,
): boolean {
  const nextMealInput = parseMealRecordPayload(nextPayload).mealInput ?? null;
  const existingMealInput =
    parseMealRecordPayload(existingPayload).mealInput ?? null;
  return !isDeepStrictEqual(nextMealInput, existingMealInput);
}

export function buildConfirmedMealPayload(
  rawPayload: unknown,
): PlainRecord | null {
  const parsed = parseMealRecordPayload(rawPayload);
  const analysis = parsed.mealAnalysis;
  if (analysis == null) {
    return null;
  }

  const confirmedAt = nowIsoString();
  const confirmedAnalysis: MealAnalysisPayload = {
    ...analysis,
    analysisStatus: 'confirmed',
    confirmedAt,
  };

  return {
    ...(parsed.mealInput != null ? { mealInput: parsed.mealInput } : {}),
    mealAnalysis: confirmedAnalysis,
    mealAnalysisLastConfirmed: confirmedAnalysis,
  };
}
