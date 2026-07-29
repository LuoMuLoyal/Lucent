import type {
  AssistantUpdateDailyRecordProposalPayload,
  AssistantUpdateUserSettingsProposalPayload,
} from '../../types/assistant.types';

export function extractRecordUpdateDraft(
  userMessage: string,
): AssistantUpdateDailyRecordProposalPayload['draft'] | null {
  const draft: AssistantUpdateDailyRecordProposalPayload['draft'] = {};
  const waterValueMatch = userMessage.match(
    /(\d+)\s*(ml|毫升|cup|cups|杯|次)/i,
  );
  if (waterValueMatch?.[1] != null) {
    draft.value = waterValueMatch[1];
    draft.unit = normalizeUnit(waterValueMatch[2] ?? null);
  }
  const noteMatch = userMessage.match(
    /(?:备注|note|改成|改为|更新为)\s*[:：]?\s*(.+)$/i,
  );
  if (noteMatch?.[1] != null) {
    draft.note = noteMatch[1].trim().replace(/^(?:改成|改为|更新为)\s*/i, '');
  }
  const titleMatch = userMessage.match(/(?:标题|title)\s*[:：]?\s*(.+)$/i);
  if (titleMatch?.[1] != null) {
    draft.title = titleMatch[1].trim();
  }
  return Object.keys(draft).length > 0 ? draft : null;
}

export function extractSettingsDraft(
  userMessage: string,
): AssistantUpdateUserSettingsProposalPayload['draft'] {
  const draft: AssistantUpdateUserSettingsProposalPayload['draft'] = {};
  const lowered = userMessage.toLowerCase();
  if (/关闭.*ai|disable.*ai|turn off.*ai/.test(lowered)) {
    draft.assistantEnabled = false;
  } else if (/打开.*ai|enable.*ai|turn on.*ai/.test(lowered)) {
    draft.assistantEnabled = true;
  }
  if (/关闭.*记忆|disable.*memory|turn off.*memory/.test(lowered)) {
    draft.assistantMemoryEnabled = false;
  } else if (/打开.*记忆|enable.*memory|turn on.*memory/.test(lowered)) {
    draft.assistantMemoryEnabled = true;
  }
  const contextDraft: NonNullable<
    AssistantUpdateUserSettingsProposalPayload['draft']['assistantContext']
  > = {};
  applyContextToggle(
    contextDraft,
    lowered,
    'healthProfile',
    /健康档案|profile/,
  );
  applyContextToggle(
    contextDraft,
    lowered,
    'dailyRecords',
    /记录|daily record/,
  );
  applyContextToggle(contextDraft, lowered, 'sleepRecords', /睡眠|sleep/);
  applyContextToggle(
    contextDraft,
    lowered,
    'currentMedicines',
    /用药|药物|medicine|medication/,
  );
  if (Object.keys(contextDraft).length > 0) {
    draft.assistantContext = contextDraft;
  }
  return draft;
}

function applyContextToggle(
  output: Record<string, boolean>,
  lowered: string,
  key: 'healthProfile' | 'dailyRecords' | 'sleepRecords' | 'currentMedicines',
  rule: RegExp,
): void {
  if (!rule.test(lowered)) {
    return;
  }
  if (/关闭|disable|turn off/.test(lowered)) {
    output[key] = false;
    return;
  }
  if (/打开|enable|turn on/.test(lowered)) {
    output[key] = true;
  }
}

function normalizeUnit(raw: string | null): string | null {
  if (raw == null) {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === '毫升') {
    return 'ml';
  }
  if (normalized === '杯' || normalized === 'cups') {
    return 'cup';
  }
  if (normalized === '次') {
    return 'times';
  }
  return normalized.length > 0 ? normalized : null;
}
