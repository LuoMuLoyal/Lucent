import { Injectable } from '@nestjs/common';
import { DailyRecordCandidatesService } from '../../daily-records/services/daily-record-candidates.service';
import type {
  AssistantCreateDailyRecordProposalPayload,
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
  AssistantUpdateDailyRecordProposalPayload,
  AssistantUpdateUserSettingsProposalPayload,
} from '../types/assistant.types';
import type { AssistantToolName } from './assistant-tool.types';
import { AssistantToolRecordQueryService } from './assistant-tool-record-query.service';
import {
  DEFAULT_PROPOSAL_DATE_OFFSET_DAYS,
  PROPOSAL_TTL_MINUTES,
} from './assistant-tool.constants';
import {
  buildCreateRecordPreviewFields,
  buildProposalExpiryIso,
  buildSettingsPreviewFields,
  buildUpdateRecordPreviewFields,
  collectSettingsDraftKeys,
  describeCreateRecordSummary,
  describeDeleteRecordSummary,
  describeRecordTargetLabel,
  describeUpdateRecordSummary,
  localeText,
} from './assistant-tool-presenters';

@Injectable()
export class AssistantToolProposalService {
  constructor(
    private readonly dailyRecordCandidatesService: DailyRecordCandidatesService,
    private readonly recordQueryService: AssistantToolRecordQueryService,
  ) {}

  async buildCreateDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    const occurredAtResolution = this.recordQueryService.resolveSingleDate(
      context.userMessage,
      {
        fallbackDate: this.offsetDateString(DEFAULT_PROPOSAL_DATE_OFFSET_DAYS),
        defaultAmbiguity:
          'No explicit date detected, so the draft defaults to today.',
      },
    );
    const candidates = await this.dailyRecordCandidatesService.generate(
      {
        text: context.userMessage,
        occurredAt: occurredAtResolution.date,
      },
      context.locale,
    );
    const first = candidates.items[0];
    if (first == null) {
      return {
        name: toolName,
        data: {
          confirmationHint: candidates.confirmationHint,
          selectedDate: occurredAtResolution.date,
          ambiguities: occurredAtResolution.ambiguities,
          candidates: [],
        },
      };
    }

    const payload: AssistantCreateDailyRecordProposalPayload = {
      type: 'create_daily_record',
      draft: {
        kind: first.kind,
        occurredAt: first.occurredAt,
        title: first.title,
        value: first.value,
        unit: first.unit,
        note: first.note,
        payload: first.payload,
      },
    };

    return {
      name: toolName,
      data: {
        confirmationHint: candidates.confirmationHint,
        selectedDate: occurredAtResolution.date,
        ambiguities: occurredAtResolution.ambiguities,
        candidateCount: candidates.items.length,
        candidates: candidates.items,
      },
      proposedActions: [
        {
          id: `proposal-create-${String(Date.now())}`,
          type: 'create_daily_record',
          status: 'proposed',
          confirmationRequired: true,
          title: localeText(context.locale, '保存这条记录', 'Save this record'),
          summary: describeCreateRecordSummary(first, context.locale),
          reason: first.rationale,
          previewFields: buildCreateRecordPreviewFields(first, context.locale),
          target: {
            kind: 'daily_record_draft',
            label: describeRecordTargetLabel(first, context.locale),
            matchedBy: occurredAtResolution.matchedBy,
            snapshot: payload.draft,
          },
          constraints: [
            localeText(
              context.locale,
              '必须先经过你确认，后端不会直接写入。',
              'Must be confirmed by you before any write happens.',
            ),
            localeText(
              context.locale,
              '确认后只会按当前草稿创建一条记录，不会扩展到其他字段。',
              'Confirmation creates exactly one record from this draft and nothing broader.',
            ),
            localeText(
              context.locale,
              '如果你稍后改变想法，应重新生成新的草稿再确认。',
              'If your intent changes, generate a fresh draft instead of reusing this one.',
            ),
          ],
          expiresAt: buildProposalExpiryIso(PROPOSAL_TTL_MINUTES),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  async buildUpdateDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    const target =
      await this.recordQueryService.findTargetDailyRecordForMutation(context, {
        dateResolution: this.recordQueryService.resolveSingleDate(
          context.userMessage,
          {
            fallbackDate: this.todayDateString(),
            defaultAmbiguity:
              'No explicit date detected, so record matching defaulted to today.',
          },
        ),
      });
    const updateDraft = this.extractRecordUpdateDraft(context.userMessage);
    if (target.record == null || updateDraft == null) {
      return {
        name: toolName,
        data: {
          selectedDate: target.date,
          matchedRecord: target.record,
          matchedBy: target.matchedBy,
          ambiguities: target.ambiguities,
          confidence: target.confidence,
          reason: target.reason,
          candidateCount: target.candidateCount,
          draft: updateDraft,
        },
      };
    }
    const payload: AssistantUpdateDailyRecordProposalPayload = {
      type: 'update_daily_record',
      recordId: target.record.id,
      draft: updateDraft,
    };
    return {
      name: toolName,
      data: {
        selectedDate: target.date,
        matchedRecord: target.record,
        matchedBy: target.matchedBy,
        ambiguities: target.ambiguities,
        confidence: target.confidence,
        reason: target.reason,
        candidateCount: target.candidateCount,
        draft: updateDraft,
      },
      proposedActions: [
        {
          id: `proposal-update-${target.record.id}`,
          type: 'update_daily_record',
          status: 'proposed',
          confirmationRequired: true,
          title: localeText(
            context.locale,
            '修改这条记录',
            'Update this record',
          ),
          summary: describeUpdateRecordSummary(target.record, context.locale),
          reason: target.reason,
          previewFields: buildUpdateRecordPreviewFields(
            updateDraft,
            context.locale,
          ),
          target: {
            kind: 'daily_record',
            label: describeRecordTargetLabel(target.record, context.locale),
            recordId: target.record.id,
            matchedBy: target.matchedBy,
            snapshot: target.record,
          },
          constraints: [
            localeText(
              context.locale,
              '必须先经过你确认，后端不会直接写入。',
              'Must be confirmed by you before any write happens.',
            ),
            localeText(
              context.locale,
              '只允许修改白名单字段：时间、标题、数值、单位、备注、结构化 payload。',
              'Only allowlisted fields can change: occurredAt, title, value, unit, note, and structured payload.',
            ),
            localeText(
              context.locale,
              '这条提案只针对当前匹配到的单条记录，若列表发生变化请重新生成。',
              'This proposal targets one matched record only. Regenerate it if the record list changes.',
            ),
          ],
          expiresAt: buildProposalExpiryIso(PROPOSAL_TTL_MINUTES),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  async buildDeleteDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    const target =
      await this.recordQueryService.findTargetDailyRecordForMutation(context, {
        dateResolution: this.recordQueryService.resolveSingleDate(
          context.userMessage,
          {
            fallbackDate: this.todayDateString(),
            defaultAmbiguity:
              'No explicit date detected, so record matching defaulted to today.',
          },
        ),
      });
    if (target.record == null) {
      return {
        name: toolName,
        data: {
          selectedDate: target.date,
          matchedRecord: null,
          matchedBy: target.matchedBy,
          ambiguities: target.ambiguities,
          confidence: target.confidence,
          reason: target.reason,
          candidateCount: target.candidateCount,
        },
      };
    }
    const payload = {
      type: 'delete_daily_record',
      recordId: target.record.id,
    } as const;
    return {
      name: toolName,
      data: {
        selectedDate: target.date,
        matchedRecord: target.record,
        matchedBy: target.matchedBy,
        ambiguities: target.ambiguities,
        confidence: target.confidence,
        reason: target.reason,
        candidateCount: target.candidateCount,
      },
      proposedActions: [
        {
          id: `proposal-delete-${target.record.id}`,
          type: 'delete_daily_record',
          status: 'proposed',
          confirmationRequired: true,
          title: localeText(
            context.locale,
            '删除这条记录',
            'Delete this record',
          ),
          summary: describeDeleteRecordSummary(target.record, context.locale),
          reason: target.reason,
          previewFields: [
            {
              label: localeText(context.locale, '记录类型', 'Kind'),
              value: target.record.kind,
            },
            {
              label: localeText(context.locale, '日期', 'Date'),
              value: target.record.occurredAt,
            },
            {
              label: localeText(context.locale, '定位方式', 'Matched by'),
              value: target.matchedBy.join(', '),
            },
          ],
          target: {
            kind: 'daily_record',
            label: describeRecordTargetLabel(target.record, context.locale),
            recordId: target.record.id,
            matchedBy: target.matchedBy,
            snapshot: target.record,
          },
          constraints: [
            localeText(
              context.locale,
              '必须先经过你确认，后端不会直接删除。',
              'Must be confirmed by you before any deletion happens.',
            ),
            localeText(
              context.locale,
              '只会删除当前匹配到的这一条记录，不会批量删除。',
              'Only the single matched record can be deleted. No bulk delete is allowed.',
            ),
            localeText(
              context.locale,
              '如果你表达得不够具体，系统宁可拒绝生成提案，也不会猜测要删哪条。',
              'If your message is not specific enough, the system refuses to guess which record to delete.',
            ),
          ],
          expiresAt: buildProposalExpiryIso(PROPOSAL_TTL_MINUTES),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  buildUpdateUserSettingsProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): AssistantToolExecutionResult {
    const draft = this.extractSettingsDraft(context.userMessage);
    if (
      draft.assistantEnabled == null &&
      draft.assistantMemoryEnabled == null &&
      draft.assistantContext == null
    ) {
      return {
        name: toolName,
        data: {
          draft,
          matchedSettingKeys: [],
        },
      };
    }
    const payload: AssistantUpdateUserSettingsProposalPayload = {
      type: 'update_user_settings',
      draft,
    };
    const settingKeys = collectSettingsDraftKeys(draft);
    return {
      name: toolName,
      data: {
        draft,
        matchedSettingKeys: settingKeys,
      },
      proposedActions: [
        {
          id: `proposal-settings-${String(Date.now())}`,
          type: 'update_user_settings',
          status: 'proposed',
          confirmationRequired: true,
          title: localeText(
            context.locale,
            '更新助手相关设置',
            'Update assistant settings',
          ),
          summary: localeText(
            context.locale,
            '我整理出了一组设置变更，确认后才会真正写入。',
            'I prepared a settings change set. Nothing will be written until you confirm.',
          ),
          reason: null,
          previewFields: buildSettingsPreviewFields(draft, context.locale),
          target: {
            kind: 'user_settings',
            label: localeText(context.locale, '助手设置', 'Assistant settings'),
            settingKeys,
            snapshot: draft,
          },
          constraints: [
            localeText(
              context.locale,
              '必须先经过你确认，后端不会直接写入。',
              'Must be confirmed by you before any write happens.',
            ),
            localeText(
              context.locale,
              '这里只允许修改助手相关设置，不会触碰其他用户设置。',
              'Only assistant-related settings are allowed here. Nothing outside that scope can change.',
            ),
            localeText(
              context.locale,
              '如果你想调整更多设置，应重新生成新的提案。',
              'Generate a new proposal if you want a broader settings change.',
            ),
          ],
          expiresAt: buildProposalExpiryIso(PROPOSAL_TTL_MINUTES),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  private extractRecordUpdateDraft(
    userMessage: string,
  ): AssistantUpdateDailyRecordProposalPayload['draft'] | null {
    const draft: AssistantUpdateDailyRecordProposalPayload['draft'] = {};
    const waterValueMatch = userMessage.match(
      /(\d+)\s*(ml|毫升|cup|cups|杯|次)/i,
    );
    if (waterValueMatch?.[1] != null) {
      draft.value = waterValueMatch[1];
      draft.unit = this.normalizeUnit(waterValueMatch[2] ?? null);
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

  private extractSettingsDraft(
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
    this.applyContextToggle(
      contextDraft,
      lowered,
      'healthProfile',
      /健康档案|profile/,
    );
    this.applyContextToggle(
      contextDraft,
      lowered,
      'dailyRecords',
      /记录|daily record/,
    );
    this.applyContextToggle(
      contextDraft,
      lowered,
      'sleepRecords',
      /睡眠|sleep/,
    );
    this.applyContextToggle(
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

  private applyContextToggle(
    output: Record<string, boolean>,
    lowered: string,
    key: 'healthProfile' | 'dailyRecords' | 'sleepRecords' | 'currentMedicines',
    rule: RegExp,
  ) {
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

  private normalizeUnit(raw: string | null): string | null {
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

  private todayDateString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private offsetDateString(offsetDays: number): string {
    const now = new Date();
    const shifted = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + offsetDays,
      ),
    );
    return shifted.toISOString().slice(0, 10);
  }
}
