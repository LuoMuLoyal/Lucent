import { Injectable } from '@nestjs/common';
import { DailyRecordKind } from '../../../generated/prisma/client';
import { DailyRecordCandidatesService } from '../../daily-records/daily-record-candidates.service';
import { DailyRecordsService } from '../../daily-records/daily-records.service';
import type {
  AssistantCreateDailyRecordProposalPayload,
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
  AssistantUpdateDailyRecordProposalPayload,
  AssistantUpdateUserSettingsProposalPayload,
} from '../assistant.types';
import type { AssistantToolName } from './assistant-tool.types';
import { AssistantToolReadService } from './assistant-tool-read.service';
import {
  DEFAULT_PROPOSAL_DATE_OFFSET_DAYS,
  PROPOSAL_TTL_MINUTES,
  type ToolMutationHints,
  type ToolMutationRankedRecord,
  type ToolMutationTargetMatch,
  type ToolRecordItem,
  type ToolSingleDateResolution,
} from './assistant-tool.constants';

@Injectable()
export class AssistantToolService {
  constructor(
    _prisma: unknown,
    _aiSummary: unknown,
    _healthContext: unknown,
    private readonly dailyRecordCandidatesService: DailyRecordCandidatesService,
    private readonly dailyRecordsService: DailyRecordsService,
    _medReminders: unknown,
    _userSettings: unknown,
    private readonly readService: AssistantToolReadService,
  ) {}

  async executeMany(
    context: AssistantToolExecutionContext,
    toolNames: readonly AssistantToolName[],
  ): Promise<AssistantToolExecutionResult[]> {
    const results: AssistantToolExecutionResult[] = [];
    for (const toolName of toolNames) {
      results.push(await this.executeOne(context, toolName));
    }
    return results;
  }

  private async executeOne(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    switch (toolName) {
      case 'get_today_records':
        return {
          name: toolName,
          data: await this.readService.getTodayRecords(context),
        };
      case 'get_records_by_date':
        return {
          name: toolName,
          data: await this.readService.getRecordsByDate(context),
        };
      case 'get_records_by_range':
        return {
          name: toolName,
          data: await this.readService.getRecordsByRange(context),
        };
      case 'get_today_summary_by_date':
        return {
          name: toolName,
          data: await this.readService.getTodaySummaryByDate(context),
        };
      case 'get_report_summary_by_range':
        return {
          name: toolName,
          data: await this.readService.getReportSummaryByRange(context),
        };
      case 'get_recent_today_summaries':
        return {
          name: toolName,
          data: await this.readService.getRecentTodaySummaries(context),
        };
      case 'get_recent_report_summaries':
        return {
          name: toolName,
          data: await this.readService.getRecentReportSummaries(context),
        };
      case 'get_user_profile':
        return {
          name: toolName,
          data: await this.readService.getUserProfile(context),
        };
      case 'get_user_settings':
        return {
          name: toolName,
          data: await this.readService.getUserSettings(context),
        };
      case 'get_current_medicines':
        return {
          name: toolName,
          data: await this.readService.getCurrentMedicines(context),
        };
      case 'get_sleep_summary_by_range':
        return {
          name: toolName,
          data: await this.readService.getSleepSummaryByRange(context),
        };
      case 'propose_create_daily_record':
        return this.buildCreateDailyRecordProposal(context, toolName);
      case 'propose_update_daily_record':
        return this.buildUpdateDailyRecordProposal(context, toolName);
      case 'propose_delete_daily_record':
        return this.buildDeleteDailyRecordProposal(context, toolName);
      case 'propose_update_user_settings':
        return this.buildUpdateUserSettingsProposal(context, toolName);
    }
  }

  private async buildCreateDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    const occurredAtResolution = this.resolveSingleDate(context.userMessage, {
      fallbackDate: this.offsetDateString(DEFAULT_PROPOSAL_DATE_OFFSET_DAYS),
      defaultAmbiguity:
        'No explicit date detected, so the draft defaults to today.',
    });
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
          title: this.localeText(
            context.locale,
            '保存这条记录',
            'Save this record',
          ),
          summary: this.describeCreateRecordSummary(first, context.locale),
          reason: first.rationale,
          previewFields: this.buildCreateRecordPreviewFields(
            first,
            context.locale,
          ),
          target: {
            kind: 'daily_record_draft',
            label: this.describeRecordTargetLabel(first, context.locale),
            matchedBy: occurredAtResolution.matchedBy,
            snapshot: payload.draft,
          },
          constraints: [
            this.localeText(
              context.locale,
              '必须先经过你确认，后端不会直接写入。',
              'Must be confirmed by you before any write happens.',
            ),
            this.localeText(
              context.locale,
              '确认后只会按当前草稿创建一条记录，不会扩展到其他字段。',
              'Confirmation creates exactly one record from this draft and nothing broader.',
            ),
            this.localeText(
              context.locale,
              '如果你稍后改变想法，应重新生成新的草稿再确认。',
              'If your intent changes, generate a fresh draft instead of reusing this one.',
            ),
          ],
          expiresAt: this.buildProposalExpiryIso(),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  private async buildUpdateDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    const target = await this.findTargetDailyRecordForMutation(context);
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
          title: this.localeText(
            context.locale,
            '修改这条记录',
            'Update this record',
          ),
          summary: this.describeUpdateRecordSummary(
            target.record,
            context.locale,
          ),
          reason: target.reason,
          previewFields: this.buildUpdateRecordPreviewFields(
            updateDraft,
            context.locale,
          ),
          target: {
            kind: 'daily_record',
            label: this.describeRecordTargetLabel(
              target.record,
              context.locale,
            ),
            recordId: target.record.id,
            matchedBy: target.matchedBy,
            snapshot: target.record,
          },
          constraints: [
            this.localeText(
              context.locale,
              '必须先经过你确认，后端不会直接写入。',
              'Must be confirmed by you before any write happens.',
            ),
            this.localeText(
              context.locale,
              '只允许修改白名单字段：时间、标题、数值、单位、备注、结构化 payload。',
              'Only allowlisted fields can change: occurredAt, title, value, unit, note, and structured payload.',
            ),
            this.localeText(
              context.locale,
              '这条提案只针对当前匹配到的单条记录，若列表发生变化请重新生成。',
              'This proposal targets one matched record only. Regenerate it if the record list changes.',
            ),
          ],
          expiresAt: this.buildProposalExpiryIso(),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  private async buildDeleteDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    const target = await this.findTargetDailyRecordForMutation(context);
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
          title: this.localeText(
            context.locale,
            '删除这条记录',
            'Delete this record',
          ),
          summary: this.describeDeleteRecordSummary(
            target.record,
            context.locale,
          ),
          reason: target.reason,
          previewFields: [
            {
              label: this.localeText(context.locale, '记录类型', 'Kind'),
              value: target.record.kind,
            },
            {
              label: this.localeText(context.locale, '日期', 'Date'),
              value: target.record.occurredAt,
            },
            {
              label: this.localeText(context.locale, '定位方式', 'Matched by'),
              value: target.matchedBy.join(', '),
            },
          ],
          target: {
            kind: 'daily_record',
            label: this.describeRecordTargetLabel(
              target.record,
              context.locale,
            ),
            recordId: target.record.id,
            matchedBy: target.matchedBy,
            snapshot: target.record,
          },
          constraints: [
            this.localeText(
              context.locale,
              '必须先经过你确认，后端不会直接删除。',
              'Must be confirmed by you before any deletion happens.',
            ),
            this.localeText(
              context.locale,
              '只会删除当前匹配到的这一条记录，不会批量删除。',
              'Only the single matched record can be deleted. No bulk delete is allowed.',
            ),
            this.localeText(
              context.locale,
              '如果你表达得不够具体，系统宁可拒绝生成提案，也不会猜测要删哪条。',
              'If your message is not specific enough, the system refuses to guess which record to delete.',
            ),
          ],
          expiresAt: this.buildProposalExpiryIso(),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  private buildUpdateUserSettingsProposal(
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
    const settingKeys = this.collectSettingsDraftKeys(draft);
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
          title: this.localeText(
            context.locale,
            '更新助手相关设置',
            'Update assistant settings',
          ),
          summary: this.localeText(
            context.locale,
            '我整理出了一组设置变更，确认后才会真正写入。',
            'I prepared a settings change set. Nothing will be written until you confirm.',
          ),
          reason: null,
          previewFields: this.buildSettingsPreviewFields(draft, context.locale),
          target: {
            kind: 'user_settings',
            label: this.localeText(
              context.locale,
              '助手设置',
              'Assistant settings',
            ),
            settingKeys,
            snapshot: draft,
          },
          constraints: [
            this.localeText(
              context.locale,
              '必须先经过你确认，后端不会直接写入。',
              'Must be confirmed by you before any write happens.',
            ),
            this.localeText(
              context.locale,
              '这里只允许修改助手相关设置，不会触碰其他用户设置。',
              'Only assistant-related settings are allowed here. Nothing outside that scope can change.',
            ),
            this.localeText(
              context.locale,
              '如果你想调整更多设置，应重新生成新的提案。',
              'Generate a new proposal if you want a broader settings change.',
            ),
          ],
          expiresAt: this.buildProposalExpiryIso(),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  private async listToolRecords(
    userId: string,
    date: string,
    options: { includeSleep: boolean; sleepOnly?: boolean },
  ): Promise<ToolRecordItem[]> {
    const result = await this.dailyRecordsService.list(
      userId,
      date,
      undefined,
      1,
      100,
    );
    return result.items
      .filter((item) => {
        if (options.sleepOnly) {
          return item.kind === DailyRecordKind.sleep;
        }
        if (!options.includeSleep && item.kind === DailyRecordKind.sleep) {
          return false;
        }
        return true;
      })
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        occurredAt: item.occurredAt,
        title: item.title ?? null,
        value: item.value ?? null,
        unit: item.unit ?? null,
        note: item.note ?? null,
        tags: [],
        payload: item.payload ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }

  private async findTargetDailyRecordForMutation(
    context: AssistantToolExecutionContext,
  ): Promise<ToolMutationTargetMatch> {
    const dateResolution = this.resolveSingleDate(context.userMessage, {
      fallbackDate: this.todayDateString(),
      defaultAmbiguity:
        'No explicit date detected, so record matching defaulted to today.',
    });
    const records = await this.listToolRecords(
      context.userId,
      dateResolution.date,
      {
        includeSleep: true,
      },
    );
    const hints: ToolMutationHints = {
      kindHint: this.extractDailyRecordKindHint(context.userMessage),
      numericHint: this.extractNumericHint(context.userMessage),
      titleHint: this.extractQuotedOrTailHint(context.userMessage),
      noteHint: this.extractNoteHint(context.userMessage),
    };
    const ambiguities = [...dateResolution.ambiguities];
    const candidateCount = records.length;

    if (candidateCount === 0) {
      return {
        date: dateResolution.date,
        record: null,
        matchedBy: dateResolution.matchedBy,
        ambiguities,
        reason: 'No records exist on the selected date.',
        confidence: {
          level: 'low',
          reason:
            'Record mutation requires an existing record, but none were found on that date.',
        },
        candidateCount,
      };
    }

    if (
      hints.kindHint == null &&
      hints.numericHint == null &&
      hints.titleHint == null &&
      hints.noteHint == null
    ) {
      ambiguities.push(
        'Missing a stable record identifier. Use a kind plus value, a quoted title, or a note fragment.',
      );
      return {
        date: dateResolution.date,
        record: null,
        matchedBy: dateResolution.matchedBy,
        ambiguities,
        reason:
          'The request did not include enough detail to identify one record safely.',
        confidence: {
          level: 'low',
          reason:
            'Update/delete proposals are withheld unless the target record can be identified with high confidence.',
        },
        candidateCount,
      };
    }

    const ranked = records
      .map((record, index) => this.rankMutationTarget(record, hints, index))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);

    const top = ranked[0];
    const second = ranked[1];
    if (top == null) {
      ambiguities.push(
        'The message hints did not match any existing record on the selected date.',
      );
      return {
        date: dateResolution.date,
        record: null,
        matchedBy: dateResolution.matchedBy,
        ambiguities,
        reason: 'No record matched the described kind/value/title/note hints.',
        confidence: {
          level: 'low',
          reason: 'No candidate record satisfied the requested mutation hints.',
        },
        candidateCount,
      };
    }

    const strongSignals = top.matchedBy.filter(
      (item) => item === 'value' || item === 'title' || item === 'note',
    );
    const hasStrongSignals = strongSignals.length > 0;
    const isSingleCandidateWithKind =
      candidateCount === 1 &&
      hints.kindHint != null &&
      top.matchedBy.includes('kind');
    const scoreGap =
      second == null ? Number.POSITIVE_INFINITY : top.score - second.score;

    if (!hasStrongSignals && !isSingleCandidateWithKind) {
      ambiguities.push(
        'Kind alone is not specific enough to mutate a record safely.',
      );
      return {
        date: dateResolution.date,
        record: null,
        matchedBy: [...dateResolution.matchedBy, ...top.matchedBy],
        ambiguities,
        reason: 'The best match is still too broad to modify safely.',
        confidence: {
          level: 'low',
          reason:
            'High-constraint mutation proposals require a stronger identifier than kind alone.',
        },
        candidateCount,
      };
    }

    if (scoreGap < 4) {
      ambiguities.push(
        'More than one record matched too closely, so no mutation proposal was created.',
      );
      return {
        date: dateResolution.date,
        record: null,
        matchedBy: [...dateResolution.matchedBy, ...top.matchedBy],
        ambiguities,
        reason:
          'Multiple nearby records remain too similar to distinguish safely.',
        confidence: {
          level: 'low',
          reason:
            'The highest-ranked candidate was not separated enough from the next candidate.',
        },
        candidateCount,
      };
    }

    return {
      date: dateResolution.date,
      record: top.record,
      matchedBy: [...dateResolution.matchedBy, ...top.matchedBy],
      ambiguities,
      reason: hasStrongSignals
        ? 'Matched one existing record with specific value/title/note evidence.'
        : 'Matched the only record on that date for the requested kind.',
      confidence: {
        level: hasStrongSignals ? 'high' : 'medium',
        reason: hasStrongSignals
          ? 'The target record was separated by specific user-provided hints.'
          : 'Only one record existed for the requested kind on the selected date.',
      },
      candidateCount,
    };
  }

  private rankMutationTarget(
    record: ToolRecordItem,
    hints: ToolMutationHints,
    index: number,
  ): ToolMutationRankedRecord {
    const matchedBy: string[] = [];
    let score = 0;

    if (hints.kindHint != null) {
      if (record.kind !== hints.kindHint) {
        return { record, score: 0, matchedBy };
      }
      matchedBy.push('kind');
      score += 10;
    }

    if (hints.numericHint != null) {
      if (record.value === hints.numericHint) {
        matchedBy.push('value');
        score += 8;
      }
    }

    if (
      hints.titleHint != null &&
      record.title != null &&
      record.title.toLowerCase().includes(hints.titleHint.toLowerCase())
    ) {
      matchedBy.push('title');
      score += 9;
    }

    if (
      hints.noteHint != null &&
      record.note != null &&
      record.note.toLowerCase().includes(hints.noteHint.toLowerCase())
    ) {
      matchedBy.push('note');
      score += 9;
    }

    if (matchedBy.length === 0 && hints.kindHint == null) {
      return { record, score: 0, matchedBy };
    }

    score += Math.max(0, 3 - index);
    return { record, score, matchedBy };
  }

  private resolveSingleDate(
    userMessage: string,
    input: {
      fallbackDate: string;
      defaultAmbiguity: string;
    },
  ): ToolSingleDateResolution {
    const iso = userMessage.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso?.[1] != null) {
      return {
        date: iso[1],
        matchedBy: ['explicit_iso_date'],
        ambiguities: [],
      };
    }

    const chinese = userMessage.match(/(\d{1,2})月(\d{1,2})日/);
    if (chinese?.[1] != null && chinese[2] != null) {
      const year = new Date().getUTCFullYear();
      const month = Number(chinese[1]);
      const day = Number(chinese[2]);
      return {
        date: this.makeDateString(year, month, day),
        matchedBy: ['explicit_month_day'],
        ambiguities: [],
      };
    }

    if (/今天|today/i.test(userMessage)) {
      return {
        date: this.todayDateString(),
        matchedBy: ['relative_today'],
        ambiguities: [],
      };
    }

    if (/昨天|yesterday/i.test(userMessage)) {
      return {
        date: this.offsetDateString(-1),
        matchedBy: ['relative_yesterday'],
        ambiguities: [],
      };
    }

    if (/前天/.test(userMessage)) {
      return {
        date: this.offsetDateString(-2),
        matchedBy: ['relative_day_before_yesterday'],
        ambiguities: [],
      };
    }

    return {
      date: input.fallbackDate,
      matchedBy: ['default_today'],
      ambiguities: [input.defaultAmbiguity],
    };
  }

  private extractDailyRecordKindHint(userMessage: string): string | null {
    if (/喝水|饮水|water/i.test(userMessage)) {
      return DailyRecordKind.water;
    }
    if (/吃饭|饮食|meal/i.test(userMessage)) {
      return DailyRecordKind.meal;
    }
    if (/症状|头痛|不舒服|symptom/i.test(userMessage)) {
      return DailyRecordKind.symptom;
    }
    if (/备注|自定义|note/i.test(userMessage)) {
      return DailyRecordKind.note;
    }
    if (/睡眠|睡觉|sleep/i.test(userMessage)) {
      return DailyRecordKind.sleep;
    }
    return null;
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

  private buildCreateRecordPreviewFields(
    item: {
      kind: string;
      occurredAt: string;
      title: string | null;
      value: string | null;
      unit: string | null;
      note: string | null;
    },
    locale: 'zh-CN' | 'en',
  ) {
    const fields = [
      {
        label: this.localeText(locale, '类型', 'Kind'),
        value: item.kind,
      },
      {
        label: this.localeText(locale, '日期', 'Date'),
        value: item.occurredAt,
      },
    ];
    if (item.value != null) {
      fields.push({
        label: this.localeText(locale, '数值', 'Value'),
        value: item.unit != null ? `${item.value} ${item.unit}` : item.value,
      });
    }
    if (item.title != null) {
      fields.push({
        label: this.localeText(locale, '标题', 'Title'),
        value: item.title,
      });
    }
    if (item.note != null) {
      fields.push({
        label: this.localeText(locale, '备注', 'Note'),
        value: item.note,
      });
    }
    return fields;
  }

  private buildUpdateRecordPreviewFields(
    draft: AssistantUpdateDailyRecordProposalPayload['draft'],
    locale: 'zh-CN' | 'en',
  ) {
    const fields: Array<{ label: string; value: string }> = [];
    if (draft.title != null) {
      fields.push({
        label: this.localeText(locale, '标题', 'Title'),
        value: draft.title,
      });
    }
    if (draft.value != null) {
      fields.push({
        label: this.localeText(locale, '数值', 'Value'),
        value:
          draft.unit != null ? `${draft.value} ${draft.unit}` : draft.value,
      });
    }
    if (draft.note != null) {
      fields.push({
        label: this.localeText(locale, '备注', 'Note'),
        value: draft.note,
      });
    }
    return fields;
  }

  private buildSettingsPreviewFields(
    draft: AssistantUpdateUserSettingsProposalPayload['draft'],
    locale: 'zh-CN' | 'en',
  ) {
    const fields: Array<{ label: string; value: string }> = [];
    if (draft.assistantEnabled != null) {
      fields.push({
        label: this.localeText(locale, '助手', 'Assistant'),
        value: this.boolText(draft.assistantEnabled, locale),
      });
    }
    if (draft.assistantMemoryEnabled != null) {
      fields.push({
        label: this.localeText(locale, '持久化记忆', 'Persistent memory'),
        value: this.boolText(draft.assistantMemoryEnabled, locale),
      });
    }
    if (draft.assistantContext != null) {
      for (const [key, value] of Object.entries(draft.assistantContext)) {
        fields.push({
          label: this.contextPreviewLabel(key, locale),
          value: this.boolText(value, locale),
        });
      }
    }
    return fields;
  }

  private contextPreviewLabel(key: string, locale: 'zh-CN' | 'en'): string {
    switch (key) {
      case 'healthProfile':
        return this.localeText(locale, '健康档案', 'Health profile');
      case 'dailyRecords':
        return this.localeText(locale, '最近记录', 'Recent records');
      case 'sleepRecords':
        return this.localeText(locale, '睡眠数据', 'Sleep data');
      case 'currentMedicines':
        return this.localeText(locale, '当前用药', 'Current medicines');
      default:
        return key;
    }
  }

  private describeCreateRecordSummary(
    item: {
      kind: string;
      occurredAt: string;
      value: string | null;
      unit: string | null;
    },
    locale: 'zh-CN' | 'en',
  ): string {
    if (locale === 'zh-CN') {
      return item.value != null
        ? `准备保存一条 ${item.occurredAt} 的 ${item.kind} 记录。`
        : `准备保存一条 ${item.occurredAt} 的记录。`;
    }
    return `Ready to save one ${item.kind} record for ${item.occurredAt}.`;
  }

  private describeUpdateRecordSummary(
    target: ToolRecordItem,
    locale: 'zh-CN' | 'en',
  ): string {
    return locale === 'zh-CN'
      ? `准备修改 ${target.occurredAt} 的一条 ${target.kind} 记录。`
      : `Ready to update one ${target.kind} record from ${target.occurredAt}.`;
  }

  private describeDeleteRecordSummary(
    target: ToolRecordItem,
    locale: 'zh-CN' | 'en',
  ): string {
    return locale === 'zh-CN'
      ? `准备删除 ${target.occurredAt} 的一条 ${target.kind} 记录。`
      : `Ready to delete one ${target.kind} record from ${target.occurredAt}.`;
  }

  private describeRecordTargetLabel(
    item: {
      kind: string;
      occurredAt: string;
      value?: string | null;
      unit?: string | null;
    },
    locale: 'zh-CN' | 'en',
  ): string {
    const valuePart =
      item.value != null
        ? ` ${item.value}${item.unit != null ? ` ${item.unit}` : ''}`
        : '';
    return locale === 'zh-CN'
      ? `${item.occurredAt} ${item.kind}${valuePart}`
      : `${item.occurredAt} ${item.kind}${valuePart}`;
  }

  private collectSettingsDraftKeys(
    draft: AssistantUpdateUserSettingsProposalPayload['draft'],
  ): string[] {
    const keys: string[] = [];
    if (draft.assistantEnabled != null) {
      keys.push('assistantEnabled');
    }
    if (draft.assistantMemoryEnabled != null) {
      keys.push('assistantMemoryEnabled');
    }
    if (draft.assistantContext != null) {
      for (const key of Object.keys(draft.assistantContext)) {
        keys.push(`assistantContext.${key}`);
      }
    }
    return keys;
  }

  private buildProposalExpiryIso(): string {
    return new Date(
      Date.now() + PROPOSAL_TTL_MINUTES * 60 * 1000,
    ).toISOString();
  }

  private localeText(
    locale: 'zh-CN' | 'en',
    zhText: string,
    enText: string,
  ): string {
    return locale === 'zh-CN' ? zhText : enText;
  }

  private boolText(value: boolean, locale: 'zh-CN' | 'en'): string {
    return locale === 'zh-CN'
      ? value
        ? '开启'
        : '关闭'
      : value
        ? 'On'
        : 'Off';
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

  private extractNumericHint(userMessage: string): string | null {
    const match = userMessage.match(
      /\b(\d+(?:\.\d+)?)\s*(ml|毫升|cup|cups|杯|次)?/i,
    );
    return match?.[1] != null ? match[1].trim() : null;
  }

  private extractQuotedOrTailHint(userMessage: string): string | null {
    const quoted = userMessage.match(/["“](.+?)["”]/);
    if (quoted?.[1] != null) {
      return quoted[1].trim();
    }
    const tail = userMessage.match(
      /(?:标题|title|那条|这条)\s*[:：]?\s*(.+)$/i,
    );
    return tail?.[1] != null ? tail[1].trim() : null;
  }

  private extractNoteHint(userMessage: string): string | null {
    const noteMatch = userMessage.match(
      /(?:备注|note|内容|content)\s*[:：]?\s*(.+)$/i,
    );
    return noteMatch?.[1] != null ? noteMatch[1].trim() : null;
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

  private makeDateString(year: number, month: number, day: number): string {
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  }
}
