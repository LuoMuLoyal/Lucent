import type {
  AssistantReadConfidence,
  AssistantReadCoverage,
  AssistantReadResultEnvelope,
  AssistantUpdateDailyRecordProposalPayload,
  AssistantUpdateUserSettingsProposalPayload,
} from '../types/assistant.types.js';
import type { AssistantToolName } from './shared/tool-types.js';
import { DailyRecordKind } from '#generated/prisma/client.js';
import { nowIsoString } from '../../../common/index.js';
import {
  RANGE_TRUNCATED_MESSAGE,
  MAX_RANGE_DAYS,
} from './shared/tool-constants.js';

/**
 * Translator bound to one locale by the caller.
 *
 * The presenter helpers below are plain functions rather than DI providers, so
 * instead of reaching for a global i18n instance they receive a translator that
 * the owning service builds from its injected `I18nService` (see
 * `shared/copy.ts`). That keeps them pure and unit-testable while getting the
 * copy out of the source file.
 */
export type AssistantTranslator = (
  key: string,
  args?: Record<string, string | number>,
) => string;

export function buildReadEnvelope(input: {
  toolName: AssistantToolName;
  query: Record<string, unknown>;
  result: Record<string, unknown>;
  coverage: AssistantReadCoverage;
  timeRange: AssistantReadResultEnvelope['timeRange'];
  confidence: AssistantReadConfidence;
  ambiguities: string[];
  tables: string[];
}): AssistantReadResultEnvelope {
  return {
    query: input.query,
    result: input.result,
    coverage: input.coverage,
    timeRange: input.timeRange,
    source: {
      tool: input.toolName,
      generatedAt: nowIsoString(),
      tables: input.tables,
    },
    confidence: input.confidence,
    ambiguities: input.ambiguities,
  };
}

export function buildDailyRecordCoverage(input: {
  hasData: boolean;
  sleepIncluded: boolean;
}): AssistantReadCoverage {
  if (!input.sleepIncluded)
    return {
      status: 'partial',
      reason: 'Sleep records are excluded because sleep context is disabled.',
      omittedContextSources: ['sleep_records'],
      omittedKinds: ['sleep'],
    };
  if (!input.hasData)
    return {
      status: 'empty',
      reason: 'No daily records were found for the selected date.',
    };
  return { status: 'complete', reason: null };
}

export function buildDailyRecordRangeCoverage(input: {
  total: number;
  truncated: boolean;
  sleepIncluded: boolean;
}): AssistantReadCoverage {
  const reasons: string[] = [];
  if (input.truncated) reasons.push(RANGE_TRUNCATED_MESSAGE(MAX_RANGE_DAYS));
  if (!input.sleepIncluded)
    reasons.push(
      'Sleep records are excluded because sleep context is disabled.',
    );
  if (reasons.length > 0) {
    const coverage: AssistantReadCoverage = {
      status: 'partial',
      reason: reasons.join(' '),
    };
    if (!input.sleepIncluded) {
      coverage.omittedContextSources = ['sleep_records'];
      coverage.omittedKinds = [DailyRecordKind.sleep];
    }
    return coverage;
  }
  if (input.total === 0)
    return {
      status: 'empty',
      reason: 'No daily records were found in the selected range.',
    };
  return { status: 'complete', reason: null };
}

export function buildReadConfidence(input: {
  ambiguities: string[];
  truncated?: boolean;
  preferredReason: string;
}): AssistantReadConfidence {
  if (input.ambiguities.length === 0 && !input.truncated)
    return { level: 'high', reason: input.preferredReason };
  if (input.ambiguities.length <= 2)
    return { level: 'medium', reason: input.preferredReason };
  return { level: 'low', reason: input.preferredReason };
}

export function buildProposalExpiryIso(ttlMinutes: number): string {
  return new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
}

// Preview field builders
export function buildCreateRecordPreviewFields(
  item: {
    kind: DailyRecordKind;
    occurredAt: string;
    title: string | null;
    value: string | null;
    unit: string | null;
    note: string | null;
  },
  t: AssistantTranslator,
) {
  const fields = [
    { label: t('preview.kind'), value: item.kind },
    { label: t('preview.date'), value: item.occurredAt },
  ];
  if (item.value != null)
    fields.push({
      label: t('preview.value'),
      value: item.unit != null ? `${item.value} ${item.unit}` : item.value,
    });
  if (item.title != null)
    fields.push({
      label: t('preview.title'),
      value: item.title,
    });
  if (item.note != null)
    fields.push({
      label: t('preview.note'),
      value: item.note,
    });
  return fields;
}

export function buildUpdateRecordPreviewFields(
  draft: AssistantUpdateDailyRecordProposalPayload['draft'],
  t: AssistantTranslator,
) {
  const fields: Array<{ label: string; value: string }> = [];
  if (draft.title != null)
    fields.push({
      label: t('preview.title'),
      value: draft.title,
    });
  if (draft.value != null)
    fields.push({
      label: t('preview.value'),
      value: draft.unit != null ? `${draft.value} ${draft.unit}` : draft.value,
    });
  if (draft.note != null)
    fields.push({
      label: t('preview.note'),
      value: draft.note,
    });
  return fields;
}

export function buildSettingsPreviewFields(
  draft: AssistantUpdateUserSettingsProposalPayload['draft'],
  t: AssistantTranslator,
) {
  const fields: Array<{ label: string; value: string }> = [];
  if (draft.assistantEnabled != null)
    fields.push({
      label: t('preview.assistant'),
      value: boolText(draft.assistantEnabled, t),
    });
  if (draft.assistantMemoryEnabled != null)
    fields.push({
      label: t('preview.persistent_memory'),
      value: boolText(draft.assistantMemoryEnabled, t),
    });
  if (draft.assistantContext != null) {
    for (const [key, value] of Object.entries(draft.assistantContext)) {
      fields.push({
        label: contextPreviewLabel(key, t),
        value: boolText(value, t),
      });
    }
  }
  return fields;
}

export function collectSettingsDraftKeys(
  draft: AssistantUpdateUserSettingsProposalPayload['draft'],
): string[] {
  const keys: string[] = [];
  if (draft.assistantEnabled != null) keys.push('assistantEnabled');
  if (draft.assistantMemoryEnabled != null) keys.push('assistantMemoryEnabled');
  if (draft.assistantContext != null)
    for (const key of Object.keys(draft.assistantContext))
      keys.push(`assistantContext.${key}`);
  return keys;
}

// Locale helpers
export function boolText(value: boolean, t: AssistantTranslator): string {
  return value ? t('preview.on') : t('preview.off');
}
export function contextPreviewLabel(
  key: string,
  t: AssistantTranslator,
): string {
  switch (key) {
    case 'healthProfile':
      return t('preview.health_profile');
    case 'dailyRecords':
      return t('preview.daily_records');
    case 'sleepRecords':
      return t('preview.sleep_records');
    case 'currentMedicines':
      return t('preview.current_medicines');
    default:
      // An unknown key is a schema drift, not user copy: keep it verbatim so
      // the gap is visible instead of showing a placeholder that looks like a
      // translation bug.
      return key;
  }
}

// Summary descriptions
export function describeCreateRecordSummary(
  item: {
    kind: DailyRecordKind;
    occurredAt: string;
    value: string | null;
    unit: string | null;
  },
  t: AssistantTranslator,
): string {
  return item.value != null
    ? t('proposal.summary.create_record', {
        kind: item.kind,
        occurredAt: item.occurredAt,
      })
    : t('proposal.summary.create_record_no_kind', {
        occurredAt: item.occurredAt,
      });
}

export function describeUpdateRecordSummary(
  target: { kind: DailyRecordKind; occurredAt: string },
  t: AssistantTranslator,
): string {
  return t('proposal.summary.update_record', {
    kind: target.kind,
    occurredAt: target.occurredAt,
  });
}

export function describeDeleteRecordSummary(
  target: { kind: DailyRecordKind; occurredAt: string },
  t: AssistantTranslator,
): string {
  return t('proposal.summary.delete_record', {
    kind: target.kind,
    occurredAt: target.occurredAt,
  });
}

export function describeRecordTargetLabel(
  item: {
    kind: DailyRecordKind;
    occurredAt: string;
    value?: string | null;
    unit?: string | null;
  },
  _t: AssistantTranslator,
): string {
  const valuePart =
    item.value != null
      ? ` ${item.value}${item.unit != null ? ` ${item.unit}` : ''}`
      : '';
  return `${item.occurredAt} ${item.kind}${valuePart}`;
}
