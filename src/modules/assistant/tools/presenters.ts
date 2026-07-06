import type {
  AssistantReadConfidence,
  AssistantReadCoverage,
  AssistantReadResultEnvelope,
  AssistantUpdateDailyRecordProposalPayload,
  AssistantUpdateUserSettingsProposalPayload,
} from '../types/types';
import type { AssistantToolName } from './types';
import { DailyRecordKind } from '#generated/prisma/client';
import { nowIsoString } from '../../../common/helpers/date-time.utils';
import { RANGE_TRUNCATED_MESSAGE, MAX_RANGE_DAYS } from './constants';

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
  locale: 'zh-CN' | 'en',
) {
  const fields = [
    { label: localeText(locale, '类型', 'Kind'), value: item.kind },
    { label: localeText(locale, '日期', 'Date'), value: item.occurredAt },
  ];
  if (item.value != null)
    fields.push({
      label: localeText(locale, '数值', 'Value'),
      value: item.unit != null ? `${item.value} ${item.unit}` : item.value,
    });
  if (item.title != null)
    fields.push({
      label: localeText(locale, '标题', 'Title'),
      value: item.title,
    });
  if (item.note != null)
    fields.push({
      label: localeText(locale, '备注', 'Note'),
      value: item.note,
    });
  return fields;
}

export function buildUpdateRecordPreviewFields(
  draft: AssistantUpdateDailyRecordProposalPayload['draft'],
  locale: 'zh-CN' | 'en',
) {
  const fields: Array<{ label: string; value: string }> = [];
  if (draft.title != null)
    fields.push({
      label: localeText(locale, '标题', 'Title'),
      value: draft.title,
    });
  if (draft.value != null)
    fields.push({
      label: localeText(locale, '数值', 'Value'),
      value: draft.unit != null ? `${draft.value} ${draft.unit}` : draft.value,
    });
  if (draft.note != null)
    fields.push({
      label: localeText(locale, '备注', 'Note'),
      value: draft.note,
    });
  return fields;
}

export function buildSettingsPreviewFields(
  draft: AssistantUpdateUserSettingsProposalPayload['draft'],
  locale: 'zh-CN' | 'en',
) {
  const fields: Array<{ label: string; value: string }> = [];
  if (draft.assistantEnabled != null)
    fields.push({
      label: localeText(locale, '助手', 'Assistant'),
      value: boolText(draft.assistantEnabled, locale),
    });
  if (draft.assistantMemoryEnabled != null)
    fields.push({
      label: localeText(locale, '持久化记忆', 'Persistent memory'),
      value: boolText(draft.assistantMemoryEnabled, locale),
    });
  if (draft.assistantContext != null) {
    for (const [key, value] of Object.entries(draft.assistantContext)) {
      fields.push({
        label: contextPreviewLabel(key, locale),
        value: boolText(value, locale),
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
export function localeText(
  locale: 'zh-CN' | 'en',
  zhText: string,
  enText: string,
): string {
  return locale === 'zh-CN' ? zhText : enText;
}
export function boolText(value: boolean, locale: 'zh-CN' | 'en'): string {
  return locale === 'zh-CN' ? (value ? '开启' : '关闭') : value ? 'On' : 'Off';
}
export function contextPreviewLabel(
  key: string,
  locale: 'zh-CN' | 'en',
): string {
  switch (key) {
    case 'healthProfile':
      return localeText(locale, '健康档案', 'Health profile');
    case 'dailyRecords':
      return localeText(locale, '最近记录', 'Recent records');
    case 'sleepRecords':
      return localeText(locale, '睡眠数据', 'Sleep data');
    case 'currentMedicines':
      return localeText(locale, '当前用药', 'Current medicines');
    default:
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
  locale: 'zh-CN' | 'en',
): string {
  if (locale === 'zh-CN')
    return item.value != null
      ? `准备保存一条 ${item.occurredAt} 的 ${item.kind} 记录。`
      : `准备保存一条 ${item.occurredAt} 的记录。`;
  return `Ready to save one ${item.kind} record for ${item.occurredAt}.`;
}

export function describeUpdateRecordSummary(
  target: { kind: DailyRecordKind; occurredAt: string },
  locale: 'zh-CN' | 'en',
): string {
  return locale === 'zh-CN'
    ? `准备修改 ${target.occurredAt} 的一条 ${target.kind} 记录。`
    : `Ready to update one ${target.kind} record from ${target.occurredAt}.`;
}

export function describeDeleteRecordSummary(
  target: { kind: DailyRecordKind; occurredAt: string },
  locale: 'zh-CN' | 'en',
): string {
  return locale === 'zh-CN'
    ? `准备删除 ${target.occurredAt} 的一条 ${target.kind} 记录。`
    : `Ready to delete one ${target.kind} record from ${target.occurredAt}.`;
}

export function describeRecordTargetLabel(
  item: {
    kind: DailyRecordKind;
    occurredAt: string;
    value?: string | null;
    unit?: string | null;
  },
  _locale: 'zh-CN' | 'en',
): string {
  const valuePart =
    item.value != null
      ? ` ${item.value}${item.unit != null ? ` ${item.unit}` : ''}`
      : '';
  return `${item.occurredAt} ${item.kind}${valuePart}`;
}
