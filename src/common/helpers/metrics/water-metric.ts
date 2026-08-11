import type { ObservedMetric } from '../../types/observed-metric.types';

export interface WaterMetricInput {
  value: unknown;
  unit: unknown;
}

export interface ParsedWaterMetric {
  valueMl: number;
}

export type WaterMetricState = 'unknown' | 'observed';

export interface WaterMetricSummary {
  totalMl: number | null;
  state: WaterMetricState;
  observedCount: number;
  ignoredCount: number;
}

/** Legacy water-target setting unit: one check-in represents 250 ml. */
export const WATER_TARGET_ML_PER_COUNT = 250;

const WATER_UNIT_TO_ML: Record<string, number> = {
  ml: 1,
  l: 1000,
  liter: 1000,
  litre: 1000,
};

export function parseWaterMetric(
  input: WaterMetricInput,
): ParsedWaterMetric | null {
  const value = parseFiniteNonNegativeNumber(input.value);
  if (value == null) {
    return null;
  }

  const unit = normalizeWaterUnit(input.unit);
  const multiplier = unit == null ? null : WATER_UNIT_TO_ML[unit];
  if (multiplier == null) {
    return null;
  }

  const valueMl = value * multiplier;
  if (!Number.isSafeInteger(Math.round(valueMl))) {
    return null;
  }

  return { valueMl: Math.round(valueMl) };
}

export function summarizeWaterMetrics(
  inputs: readonly WaterMetricInput[],
): WaterMetricSummary {
  let totalMl = 0;
  let observedCount = 0;
  let ignoredCount = 0;

  for (const input of inputs) {
    const parsed = parseWaterMetric(input);
    if (parsed == null) {
      ignoredCount += 1;
      continue;
    }

    totalMl += parsed.valueMl;
    observedCount += 1;
  }

  return {
    totalMl: observedCount === 0 ? null : totalMl,
    state: observedCount === 0 ? 'unknown' : 'observed',
    observedCount,
    ignoredCount,
  };
}

export function toObservedWaterMetric(
  summary: WaterMetricSummary,
  windowStart: Date,
): ObservedMetric<number> {
  const windowEnd = new Date(windowStart);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);
  const observed = summary.state === 'observed';

  return {
    value: summary.totalMl,
    state: summary.state,
    coverage: observed ? 'sufficient' : 'none',
    sources: observed ? ['manual'] : [],
    observedCount: summary.observedCount,
    expectedCount: null,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
}

function parseFiniteNonNegativeNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeWaterUnit(unit: unknown): string | null {
  if (typeof unit !== 'string') {
    return null;
  }

  const normalized = unit.trim().toLowerCase();
  return normalized === '' ? null : normalized;
}
