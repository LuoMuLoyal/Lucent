import { Injectable } from '@nestjs/common';
import { AiSummaryHistoryService } from '../ai-summary-history.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { DailyRecordKind } from '../../../generated/prisma/client';
import { UserHealthContextService } from '../../user-health-context/user-health-context.service';
import { DailyRecordCandidatesService } from '../../daily-records/daily-record-candidates.service';
import { DailyRecordsService } from '../../daily-records/daily-records.service';
import { MedicineRemindersService } from '../../medicine-reminders/medicine-reminders.service';
import { UserSettingsService } from '../../user-settings/user-settings.service';
import type {
  AiChatCreateDailyRecordProposalPayload,
  AiChatDeleteDailyRecordProposalPayload,
  AiChatToolExecutionContext,
  AiChatToolExecutionResult,
  AiChatUpdateDailyRecordProposalPayload,
  AiChatUpdateUserSettingsProposalPayload,
} from '../ai-chat.types';
import type { AiChatToolName } from './ai-chat-tool.types';
const DEFAULT_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 14;
const DEFAULT_HISTORY_LIMIT = 10;
const DEFAULT_PROPOSAL_DATE_OFFSET_DAYS = 0;
type ToolDateRange = {
  startDate: string;
  endDate: string;
};
type ToolRecordItem = {
  id: string;
  kind: string;
  occurredAt: string;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  tags: string[];
  payload: Record<string, unknown> | null;
};
@Injectable()
export class AiChatToolExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiSummaryHistoryService: AiSummaryHistoryService,
    private readonly userHealthContextService: UserHealthContextService,
    private readonly dailyRecordCandidatesService: DailyRecordCandidatesService,
    private readonly dailyRecordsService: DailyRecordsService,
    private readonly medicineRemindersService: MedicineRemindersService,
    private readonly userSettingsService: UserSettingsService,
  ) {}
  async executeMany(
    context: AiChatToolExecutionContext,
    toolNames: readonly AiChatToolName[],
  ): Promise<AiChatToolExecutionResult[]> {
    const results: AiChatToolExecutionResult[] = [];
    for (const toolName of toolNames) {
      results.push(await this.executeOne(context, toolName));
    }
    return results;
  }
  private async executeOne(
    context: AiChatToolExecutionContext,
    toolName: AiChatToolName,
  ): Promise<AiChatToolExecutionResult> {
    switch (toolName) {
      case 'get_today_records':
        return {
          name: toolName,
          data: await this.buildTodayRecords(context),
        };
      case 'get_records_by_date':
        return {
          name: toolName,
          data: await this.buildRecordsByDate(context),
        };
      case 'get_records_by_range':
        return {
          name: toolName,
          data: await this.buildRecordsByRange(context),
        };
      case 'get_recent_today_summaries':
        return {
          name: toolName,
          data: await this.buildRecentTodaySummaries(context),
        };
      case 'get_recent_report_summaries':
        return {
          name: toolName,
          data: await this.buildRecentReportSummaries(context),
        };
      case 'get_user_profile':
        return {
          name: toolName,
          data: await this.buildUserProfile(context),
        };
      case 'get_user_settings':
        return {
          name: toolName,
          data: await this.buildUserSettings(context),
        };
      case 'get_current_medicines':
        return {
          name: toolName,
          data: await this.buildCurrentMedicines(context),
        };
      case 'get_sleep_summary_by_range':
        return {
          name: toolName,
          data: await this.buildSleepSummaryByRange(context),
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
  private async buildTodayRecords(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const date = this.todayDateString();
    const records = await this.listToolRecords(context.userId, date, {
      includeSleep: this.canReadSleep(context),
    });
    return {
      timezone: 'UTC',
      date,
      records,
      total: records.length,
    };
  }
  private async buildRecordsByDate(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const date =
      this.extractSingleDate(context.userMessage) ?? this.todayDateString();
    const records = await this.listToolRecords(context.userId, date, {
      includeSleep: this.canReadSleep(context),
    });
    return {
      timezone: 'UTC',
      date,
      records,
      total: records.length,
    };
  }
  private async buildRecordsByRange(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const range = this.extractDateRange(context.userMessage);
    const dates = this.enumerateDates(range.startDate, range.endDate);
    const days = await Promise.all(
      dates.map(async (date) => {
        const records = await this.listToolRecords(context.userId, date, {
          includeSleep: this.canReadSleep(context),
        });
        return {
          date,
          records,
          total: records.length,
        };
      }),
    );
    return {
      timezone: 'UTC',
      startDate: range.startDate,
      endDate: range.endDate,
      truncated: false,
      days,
    };
  }
  private async buildRecentTodaySummaries(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const summaries =
      await this.aiSummaryHistoryService.listRecentTodaySummaries(
        context.userId,
        DEFAULT_HISTORY_LIMIT,
      );
    return {
      summaries,
      total: summaries.length,
    };
  }
  private async buildRecentReportSummaries(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const summaries =
      await this.aiSummaryHistoryService.listRecentReportSummaries(
        context.userId,
        DEFAULT_HISTORY_LIMIT,
      );
    return {
      summaries,
      total: summaries.length,
    };
  }
  private async buildUserProfile(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const health = await this.userHealthContextService.getForUser(
      context.userId,
    );
    const account = await this.prisma.user.findFirst({
      where: { id: context.userId, deletedAt: null },
      select: {
        nickname: true,
      },
    });
    return {
      profile: {
        nickname: account?.nickname ?? null,
        sexAtBirth: health.profile.sexAtBirth,
        birthDate: health.profile.birthDate,
        age: health.summary.age,
        heightCm: health.profile.heightCm,
        bloodType: health.profile.bloodType,
        allergies: health.allergies
          .filter((item) => item.isActive)
          .map((item) => item.label),
      },
    };
  }
  private async buildUserSettings(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const settings = await this.userSettingsService.getSettings(context.userId);
    return {
      settings: {
        aiSummariesEnabled: settings.aiSummariesEnabled,
        dataSharingConsent: settings.dataSharingConsent,
        aiChatEnabled: settings.aiChatEnabled,
        aiChatMemoryEnabled: settings.aiChatMemoryEnabled,
        aiChatContext: settings.aiChatContext,
      },
    };
  }
  private async buildCurrentMedicines(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const health = await this.userHealthContextService.getForUser(
      context.userId,
    );
    const reminders = await this.medicineRemindersService.list(
      context.userId,
      true,
    );
    const remindersByMedicineId = new Map<string, typeof reminders.items>();
    for (const reminder of reminders.items) {
      if (reminder.currentMedicineId == null) {
        continue;
      }
      const current =
        remindersByMedicineId.get(reminder.currentMedicineId) ?? [];
      current.push(reminder);
      remindersByMedicineId.set(reminder.currentMedicineId, current);
    }
    const medicines = health.currentMedicines
      .filter((item) => item.isCurrent)
      .map((item) => ({
        medicineId: item.id,
        medicineName: item.displayName,
        dose: item.doseText,
        frequency: this.describeReminderFrequency(
          remindersByMedicineId.get(item.id) ?? [],
        ),
        route: item.route,
        startedAt: item.startedAt,
        note: item.note,
      }));
    return {
      medicines,
      total: medicines.length,
    };
  }
  private async buildSleepSummaryByRange(
    context: AiChatToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const range = this.extractDateRange(context.userMessage);
    const dates = this.enumerateDates(range.startDate, range.endDate);
    const entries = await Promise.all(
      dates.map(async (date) => {
        const records = await this.listToolRecords(context.userId, date, {
          includeSleep: true,
          sleepOnly: true,
        });
        const latest = records[0] ?? null;
        const payload = latest?.payload ?? null;
        const durationMinutes =
          typeof payload?.['durationMinutes'] === 'number'
            ? payload['durationMinutes']
            : null;
        const quality =
          typeof payload?.['quality'] === 'string' ? payload['quality'] : null;
        return {
          date,
          durationMinutes,
          quality,
          startAt:
            typeof payload?.['startAt'] === 'string'
              ? payload['startAt']
              : null,
          endAt:
            typeof payload?.['endAt'] === 'string' ? payload['endAt'] : null,
        };
      }),
    );
    const durations = entries
      .map((entry) => entry.durationMinutes)
      .filter(
        (value): value is number => typeof value === 'number' && value > 0,
      );
    const qualityScores = entries
      .map((entry) => this.mapSleepQuality(entry.quality))
      .filter((value): value is number => value != null);
    return {
      startDate: range.startDate,
      endDate: range.endDate,
      nightsWithData: durations.length,
      averageDurationMinutes:
        durations.length > 0
          ? Math.round(
              durations.reduce((sum, value) => sum + value, 0) /
                durations.length,
            )
          : null,
      averageQuality:
        qualityScores.length > 0
          ? Number(
              (
                qualityScores.reduce((sum, value) => sum + value, 0) /
                qualityScores.length
              ).toFixed(2),
            )
          : null,
      entries,
    };
  }
  private async buildCreateDailyRecordProposal(
    context: AiChatToolExecutionContext,
    toolName: AiChatToolName,
  ): Promise<AiChatToolExecutionResult> {
    const occurredAt =
      this.extractSingleDate(context.userMessage) ??
      this.offsetDateString(DEFAULT_PROPOSAL_DATE_OFFSET_DAYS);
    const candidates = await this.dailyRecordCandidatesService.generate(
      {
        text: context.userMessage,
        occurredAt,
      },
      context.locale,
    );
    const first = candidates.items[0];
    if (first == null) {
      return {
        name: toolName,
        data: {
          confirmationHint: candidates.confirmationHint,
          candidates: [],
        },
      };
    }
    const payload: AiChatCreateDailyRecordProposalPayload = {
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
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }
  private async buildUpdateDailyRecordProposal(
    context: AiChatToolExecutionContext,
    toolName: AiChatToolName,
  ): Promise<AiChatToolExecutionResult> {
    const target = await this.findTargetDailyRecordForMutation(context);
    const updateDraft = this.extractRecordUpdateDraft(context.userMessage);
    if (target == null || updateDraft == null) {
      return {
        name: toolName,
        data: {
          matchedRecord: target,
          draft: updateDraft,
        },
      };
    }
    const payload: AiChatUpdateDailyRecordProposalPayload = {
      type: 'update_daily_record',
      recordId: target.id,
      draft: updateDraft,
    };
    return {
      name: toolName,
      data: {
        matchedRecord: target,
        draft: updateDraft,
      },
      proposedActions: [
        {
          id: `proposal-update-${target.id}`,
          type: 'update_daily_record',
          status: 'proposed',
          confirmationRequired: true,
          title: this.localeText(
            context.locale,
            '修改这条记录',
            'Update this record',
          ),
          summary: this.describeUpdateRecordSummary(
            target.kind,
            context.locale,
          ),
          reason: this.localeText(
            context.locale,
            '已根据你当前的话锁定到一条最近记录，并生成修改草稿。',
            'Matched one recent record from your message and prepared an update draft.',
          ),
          previewFields: this.buildUpdateRecordPreviewFields(
            updateDraft,
            context.locale,
          ),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }
  private async buildDeleteDailyRecordProposal(
    context: AiChatToolExecutionContext,
    toolName: AiChatToolName,
  ): Promise<AiChatToolExecutionResult> {
    const target = await this.findTargetDailyRecordForMutation(context);
    if (target == null) {
      return {
        name: toolName,
        data: {
          matchedRecord: null,
        },
      };
    }
    const payload: AiChatDeleteDailyRecordProposalPayload = {
      type: 'delete_daily_record',
      recordId: target.id,
    };
    return {
      name: toolName,
      data: {
        matchedRecord: target,
      },
      proposedActions: [
        {
          id: `proposal-delete-${target.id}`,
          type: 'delete_daily_record',
          status: 'proposed',
          confirmationRequired: true,
          title: this.localeText(
            context.locale,
            '删除这条记录',
            'Delete this record',
          ),
          summary: this.describeDeleteRecordSummary(target, context.locale),
          reason: this.localeText(
            context.locale,
            '已根据你当前的话锁定到一条最近记录，删除前还需要你确认。',
            'Matched one recent record from your message. Deletion still needs your confirmation.',
          ),
          previewFields: [
            {
              label: this.localeText(context.locale, '记录类型', 'Kind'),
              value: target.kind,
            },
            {
              label: this.localeText(context.locale, '日期', 'Date'),
              value: target.occurredAt,
            },
          ],
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }
  private buildUpdateUserSettingsProposal(
    context: AiChatToolExecutionContext,
    toolName: AiChatToolName,
  ): AiChatToolExecutionResult {
    const draft = this.extractSettingsDraft(context.userMessage);
    if (
      draft.aiChatEnabled == null &&
      draft.aiChatMemoryEnabled == null &&
      draft.aiChatContext == null
    ) {
      return {
        name: toolName,
        data: {
          draft,
        },
      };
    }
    const payload: AiChatUpdateUserSettingsProposalPayload = {
      type: 'update_user_settings',
      draft,
    };
    return {
      name: toolName,
      data: {
        draft,
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
      }));
  }
  private canReadSleep(context: AiChatToolExecutionContext): boolean {
    return context.enabledContextSources.includes('sleep_records');
  }
  private async findTargetDailyRecordForMutation(
    context: AiChatToolExecutionContext,
  ): Promise<ToolRecordItem | null> {
    const date =
      this.extractSingleDate(context.userMessage) ?? this.todayDateString();
    const records = await this.listToolRecords(context.userId, date, {
      includeSleep: true,
    });
    const kindHint = this.extractDailyRecordKindHint(context.userMessage);
    if (kindHint != null) {
      return records.find((record) => record.kind === kindHint) ?? null;
    }
    return records[0] ?? null;
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
  ): AiChatUpdateDailyRecordProposalPayload['draft'] | null {
    const draft: AiChatUpdateDailyRecordProposalPayload['draft'] = {};
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
      draft.note = noteMatch[1].trim();
    }
    const titleMatch = userMessage.match(/(?:标题|title)\s*[:：]?\s*(.+)$/i);
    if (titleMatch?.[1] != null) {
      draft.title = titleMatch[1].trim();
    }
    return Object.keys(draft).length > 0 ? draft : null;
  }
  private extractSettingsDraft(
    userMessage: string,
  ): AiChatUpdateUserSettingsProposalPayload['draft'] {
    const draft: AiChatUpdateUserSettingsProposalPayload['draft'] = {};
    const lowered = userMessage.toLowerCase();
    if (/关闭.*ai|disable.*ai|turn off.*ai/.test(lowered)) {
      draft.aiChatEnabled = false;
    } else if (/打开.*ai|enable.*ai|turn on.*ai/.test(lowered)) {
      draft.aiChatEnabled = true;
    }
    if (/关闭.*记忆|disable.*memory|turn off.*memory/.test(lowered)) {
      draft.aiChatMemoryEnabled = false;
    } else if (/打开.*记忆|enable.*memory|turn on.*memory/.test(lowered)) {
      draft.aiChatMemoryEnabled = true;
    }
    const contextDraft: NonNullable<
      AiChatUpdateUserSettingsProposalPayload['draft']['aiChatContext']
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
      draft.aiChatContext = contextDraft;
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
    draft: AiChatUpdateDailyRecordProposalPayload['draft'],
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
    draft: AiChatUpdateUserSettingsProposalPayload['draft'],
    locale: 'zh-CN' | 'en',
  ) {
    const fields: Array<{ label: string; value: string }> = [];
    if (draft.aiChatEnabled != null) {
      fields.push({
        label: this.localeText(locale, 'AI 对话', 'AI chat'),
        value: this.boolText(draft.aiChatEnabled, locale),
      });
    }
    if (draft.aiChatMemoryEnabled != null) {
      fields.push({
        label: this.localeText(locale, '持久化记忆', 'Persistent memory'),
        value: this.boolText(draft.aiChatMemoryEnabled, locale),
      });
    }
    if (draft.aiChatContext != null) {
      for (const [key, value] of Object.entries(draft.aiChatContext)) {
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
      note: string | null;
    },
    locale: 'zh-CN' | 'en',
  ): string {
    if (locale === 'zh-CN') {
      if (item.value != null) {
        return `准备保存一条 ${item.occurredAt} 的 ${item.kind} 记录。`;
      }
      return `准备保存一条 ${item.occurredAt} 的记录。`;
    }
    return `Ready to save one ${item.kind} record for ${item.occurredAt}.`;
  }
  private describeUpdateRecordSummary(
    kind: string,
    locale: 'zh-CN' | 'en',
  ): string {
    return locale === 'zh-CN'
      ? `准备修改一条最近的 ${kind} 记录。`
      : `Ready to update one recent ${kind} record.`;
  }
  private describeDeleteRecordSummary(
    target: ToolRecordItem,
    locale: 'zh-CN' | 'en',
  ): string {
    return locale === 'zh-CN'
      ? `准备删除 ${target.occurredAt} 的一条 ${target.kind} 记录。`
      : `Ready to delete one ${target.kind} record from ${target.occurredAt}.`;
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
  private extractSingleDate(userMessage: string): string | null {
    if (/今天|today/i.test(userMessage)) {
      return this.todayDateString();
    }
    if (/昨天/.test(userMessage)) {
      return this.offsetDateString(-1);
    }
    if (/前天/.test(userMessage)) {
      return this.offsetDateString(-2);
    }
    const iso = userMessage.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso?.[1] != null) {
      return iso[1];
    }
    const chinese = userMessage.match(/(\d{1,2})月(\d{1,2})日/);
    if (chinese?.[1] != null && chinese[2] != null) {
      const year = new Date().getUTCFullYear();
      const month = Number(chinese[1]);
      const day = Number(chinese[2]);
      return this.makeDateString(year, month, day);
    }
    return null;
  }
  private extractDateRange(userMessage: string): ToolDateRange {
    const explicitDates = Array.from(
      userMessage.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g),
      (match) => match[1],
    ).filter((value): value is string => typeof value === 'string');
    if (explicitDates.length >= 2) {
      const startDate = explicitDates[0];
      const endDate = explicitDates[1];
      if (startDate != null && endDate != null) {
        return this.normalizeRange(startDate, endDate);
      }
    }
    const recentDays = userMessage.match(/近\s*(\d+)\s*天/);
    if (recentDays?.[1] != null) {
      const days = Math.max(1, Math.min(MAX_RANGE_DAYS, Number(recentDays[1])));
      return {
        startDate: this.offsetDateString(-(days - 1)),
        endDate: this.todayDateString(),
      };
    }
    if (/这周/.test(userMessage)) {
      return {
        startDate: this.offsetDateString(-6),
        endDate: this.todayDateString(),
      };
    }
    if (/上周/.test(userMessage)) {
      return {
        startDate: this.offsetDateString(-13),
        endDate: this.offsetDateString(-7),
      };
    }
    if (/昨天/.test(userMessage)) {
      const date = this.offsetDateString(-1);
      return { startDate: date, endDate: date };
    }
    if (/今天|today/i.test(userMessage)) {
      const date = this.todayDateString();
      return { startDate: date, endDate: date };
    }
    return {
      startDate: this.offsetDateString(-(DEFAULT_RANGE_DAYS - 1)),
      endDate: this.todayDateString(),
    };
  }
  private normalizeRange(startDate: string, endDate: string): ToolDateRange {
    return startDate <= endDate
      ? { startDate, endDate }
      : { startDate: endDate, endDate: startDate };
  }
  private enumerateDates(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    const maxDays = MAX_RANGE_DAYS;
    for (
      let cursor = start, index = 0;
      cursor.getTime() <= end.getTime() && index < maxDays;
      cursor = new Date(
        Date.UTC(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth(),
          cursor.getUTCDate() + 1,
        ),
      ),
        index += 1
    ) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    return dates;
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
  private mapSleepQuality(value: string | null): number | null {
    switch (value) {
      case 'poor':
        return 1;
      case 'fair':
        return 2;
      case 'good':
        return 3;
      default:
        return null;
    }
  }
  private describeReminderFrequency(
    reminders: Array<{
      daysOfWeek?: unknown;
      scheduledHour: number;
      scheduledMinute: number;
    }>,
  ): string | null {
    if (reminders.length === 0) {
      return null;
    }
    const first = reminders[0];
    if (first == null) {
      return null;
    }
    const daily =
      Array.isArray(first.daysOfWeek) && first.daysOfWeek.length > 0
        ? `${String(first.daysOfWeek.length)} days/week`
        : 'daily';
    const times = reminders
      .map(
        (item) =>
          `${item.scheduledHour.toString().padStart(2, '0')}:${item.scheduledMinute
            .toString()
            .padStart(2, '0')}`,
      )
      .join(', ');
    return `${daily} @ ${times}`;
  }
}
