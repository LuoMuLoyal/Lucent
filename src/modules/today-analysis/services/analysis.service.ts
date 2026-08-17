import {
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';

import {
  DEFAULT_USER_TIMEZONE,
  conflict,
  formatDateOnlyInTimezone,
  now,
} from '../../../common';
import type { CreateNotificationDto } from '../../notifications';
import { HistoricalAiSummaryService } from '../../assistant';
import { NotificationsService, PushDeliveryService } from '../../notifications';
import { PrismaService } from '../../../prisma';
import { BaseLlmSummaryService } from '../../../common/llm/base-llm-summary.service';
import { LlmSafetyPolicyService } from '../../../common/llm/llm-safety-policy.service';
import type { GenerateTodayAnalysisDto } from '../dto/generate-today-analysis.dto';

import type {
  TodayAnalysisDataDto,
  TodayAnalysisReadDataDto,
} from '../dto/analysis-response.dto';
import { TodayAnalysisCopyService } from './pipeline/copy.service';
import {
  TodayAnalysisContextService,
  type TodayAnalysisContext,
} from './pipeline/context.service';
import { TodayAnalysisGeneratorService } from './pipeline/generator.service';
import type { TodayAnalysisStructuredOutput } from '../schemas/analysis.schema';
import { nowIsoString } from '../../../common';
import { TodayAnalysisMaterializationStore } from './materialization/store.service';
import type { StreamSummaryEvent } from '../../../common/api/stream-summary';

interface PreparedTodayAnalysis {
  context: TodayAnalysisContext;
  locale: string;
  metadata: TodayAnalysisMetadata;
}

interface TodayAnalysisMetadata {
  generatedAt: string;
  sourceVersion?: number;
}

type InternalTodayAnalysisDto = GenerateTodayAnalysisDto & {
  sourceVersion?: number;
};

@Injectable()
export class TodayAnalysisService extends BaseLlmSummaryService<
  TodayAnalysisContext,
  TodayAnalysisStructuredOutput,
  TodayAnalysisDataDto,
  GenerateTodayAnalysisDto,
  TodayAnalysisMetadata
> {
  protected readonly logger = new Logger(TodayAnalysisService.name);

  constructor(
    prisma: PrismaService,
    private readonly aiSummaryHistoryService: HistoricalAiSummaryService,
    private readonly contextService: TodayAnalysisContextService,
    copyService: TodayAnalysisCopyService,
    generatorService: TodayAnalysisGeneratorService,
    policyService: LlmSafetyPolicyService,
    private readonly notificationsService: NotificationsService,
    private readonly pushDeliveryService: PushDeliveryService,
    @Optional()
    private readonly materializationStore?: TodayAnalysisMaterializationStore,
  ) {
    super(prisma, copyService, generatorService, policyService);
  }

  async resolveDate(userId: string, date?: string): Promise<string> {
    if (date != null) {
      return date;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profile: { select: { timezone: true } } },
    });
    return formatDateOnlyInTimezone(
      now(),
      user?.profile?.timezone ?? DEFAULT_USER_TIMEZONE,
    );
  }

  /**
   * Runs one fenced, event-triggered analysis generation.
   *
   * The materialization row is claimed before entering the LLM path. This
   * keeps duplicate events and stale jobs from charging for the same version.
   */
  async generateForVersion(
    userId: string,
    dto: GenerateTodayAnalysisDto,
    language: string,
    sourceVersion: number,
  ): Promise<TodayAnalysisDataDto | TodayAnalysisReadDataDto> {
    const date = await this.resolveDate(userId, dto.date);
    const empty = await this.checkEmptyContext(userId, date, language);
    if (empty != null) {
      return empty;
    }

    const versionedDto = this.toVersionedDto(dto, date, sourceVersion);
    const store = this.materializationStore;
    if (store == null) {
      const data = await this.generate(userId, versionedDto, language);
      if ('status' in data) {
        return data;
      }
      data.sourceVersion = sourceVersion;
      return data;
    }

    const claim = await store.claimGeneration(userId, date, sourceVersion);
    if (!claim.claimed) {
      const current = await this.readCurrent(userId, date, language);
      if (current.analysis == null) {
        conflict(`TODAY_ANALYSIS_${claim.status.toUpperCase()}`);
      }
      return current.analysis;
    }
    // The store may be malformed at runtime even though the TypeScript union is sound.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (claim.activeVersion == null) {
      throw new InternalServerErrorException(
        'TODAY_ANALYSIS_CLAIM_FENCE_MISSING',
      );
    }
    const activeVersion = claim.activeVersion;

    try {
      const data = await this.generate(userId, versionedDto, language);
      if ('status' in data) {
        await store.markFailed({
          userId,
          localDate: date,
          sourceVersion,
          activeVersion,
          errorCode: 'ANALYSIS_CONTEXT_EMPTY',
        });
        return data;
      }
      const committed = await store.markReady({
        userId,
        localDate: date,
        sourceVersion,
        activeVersion,
      });
      if (!committed) {
        const current = await this.readCurrent(userId, date, language);
        return current.analysis ?? data;
      }
      data.sourceVersion = sourceVersion;
      return data;
    } catch (error) {
      await this.markFailedBestEffort(store, {
        userId,
        localDate: date,
        sourceVersion,
        activeVersion,
        errorCode: 'ANALYSIS_GENERATION_FAILED',
      });
      throw error;
    }
  }

  async generateStreamForVersion(
    userId: string,
    dto: GenerateTodayAnalysisDto,
    language: string,
    sourceVersion: number,
    onSummary: (event: StreamSummaryEvent) => void | Promise<void>,
  ): Promise<TodayAnalysisDataDto | TodayAnalysisReadDataDto> {
    const date = await this.resolveDate(userId, dto.date);
    const empty = await this.checkEmptyContext(userId, date, language);
    if (empty != null) {
      return empty;
    }

    const store = this.materializationStore;
    if (store == null) {
      const data = await this.generateStream(userId, dto, language, onSummary);
      if ('status' in data) {
        return data;
      }
      data.sourceVersion = sourceVersion;
      return data;
    }

    const claim = await store.claimGeneration(userId, date, sourceVersion);
    if (!claim.claimed) {
      const current = await this.readCurrent(userId, date, language);
      if (current.analysis == null) {
        conflict(`TODAY_ANALYSIS_${claim.status.toUpperCase()}`);
      }
      return current.analysis;
    }
    // The store may be malformed at runtime even though the TypeScript union is sound.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (claim.activeVersion == null) {
      throw new InternalServerErrorException(
        'TODAY_ANALYSIS_CLAIM_FENCE_MISSING',
      );
    }
    const activeVersion = claim.activeVersion;

    try {
      const data = await this.generateStream(
        userId,
        this.toVersionedDto(dto, date, sourceVersion),
        language,
        onSummary,
      );
      if ('status' in data) {
        await store.markFailed({
          userId,
          localDate: date,
          sourceVersion,
          activeVersion,
          errorCode: 'ANALYSIS_CONTEXT_EMPTY',
        });
        return data;
      }
      const committed = await store.markReady({
        userId,
        localDate: date,
        sourceVersion,
        activeVersion,
      });
      if (!committed) {
        const current = await this.readCurrent(userId, date, language);
        return current.analysis ?? data;
      }
      data.sourceVersion = sourceVersion;
      return data;
    } catch (error) {
      await this.markFailedBestEffort(store, {
        userId,
        localDate: date,
        sourceVersion,
        activeVersion,
        errorCode: 'ANALYSIS_GENERATION_FAILED',
      });
      throw error;
    }
  }

  /** Read the last persisted analysis without entering the LLM pipeline. */
  async readCurrent(
    userId: string,
    date: string,
    _language?: string,
  ): Promise<TodayAnalysisReadDataDto> {
    const status =
      this.materializationStore == null
        ? {
            status: 'empty' as const,
            sourceVersion: 0,
            computedVersion: 0,
            computedAt: null,
          }
        : await this.materializationStore.readStatus(userId, date);
    const summary =
      await this.aiSummaryHistoryService.getLatestTodaySummaryByDate(
        userId,
        date,
      );
    const analysis =
      summary != null &&
      status.status === 'ready' &&
      status.sourceVersion === status.computedVersion &&
      summary.sourceVersion != null &&
      summary.sourceVersion === status.computedVersion
        ? ({
            date: summary.date ?? date,
            generatedAt: summary.generatedAt,
            sourceVersion: summary.sourceVersion ?? status.computedVersion,
            summary: summary.summary,
            bullets: summary.bullets.map((bullet) => ({
              kind: isTodayAnalysisBulletKind(bullet.kind)
                ? bullet.kind
                : 'general',
              text: bullet.text,
            })),
            actionLabel: summary.actionLabel,
            action: summary.action,
            confidenceNote: summary.confidenceNote,
            aiGenerated: summary.aiGenerated ?? false,
          } satisfies TodayAnalysisDataDto)
        : null;

    if (analysis == null && status.status === 'empty') {
      const context = await this.contextService.build(userId, date);
      if (!this.hasMeaningfulContext(context)) {
        return {
          analysis: null,
          status: 'empty',
          sourceVersion: status.sourceVersion,
          computedVersion: status.computedVersion,
          computedAt: status.computedAt?.toISOString() ?? null,
          retryAfterSeconds: null,
        };
      }
    }

    return {
      analysis,
      status: status.status,
      sourceVersion: status.sourceVersion,
      computedVersion: status.computedVersion,
      computedAt: status.computedAt?.toISOString() ?? null,
      retryAfterSeconds: status.status === 'pending' ? 5 : null,
    };
  }

  protected async prepare(
    userId: string,
    dto: GenerateTodayAnalysisDto,
    locale: string,
  ): Promise<PreparedTodayAnalysis> {
    const date = await this.resolveDate(userId, dto.date);
    const sourceVersion = (dto as InternalTodayAnalysisDto).sourceVersion;
    const context = await this.contextService.build(userId, date);
    const generatedAt = nowIsoString();

    return {
      locale,
      context,
      metadata: {
        generatedAt,
        ...(sourceVersion != null ? { sourceVersion } : {}),
      },
    };
  }

  protected toDataDto(
    context: TodayAnalysisContext,
    output: TodayAnalysisStructuredOutput,
    metadata: TodayAnalysisMetadata,
    aiGenerated: boolean,
  ): TodayAnalysisDataDto {
    return {
      date: context.date,
      generatedAt: metadata.generatedAt,
      ...(metadata.sourceVersion != null
        ? { sourceVersion: metadata.sourceVersion }
        : {}),
      summary: output.summary,
      bullets: output.bullets,
      actionLabel: output.actionLabel,
      action: output.action,
      confidenceNote: output.confidenceNote,
      aiGenerated,
    };
  }

  protected async persistSummary(
    userId: string,
    data: TodayAnalysisDataDto,
  ): Promise<void> {
    await this.aiSummaryHistoryService.save({
      userId,
      kind: 'today',
      scopeKey: `today:${data.date}`,
      date: data.date,
      generatedAt: data.generatedAt,
      summary: data.summary,
      bullets: data.bullets,
      actionLabel: data.actionLabel,
      action: data.action,
      confidenceNote: data.confidenceNote,
      aiGenerated: data.aiGenerated,
      sourceVersion: data.sourceVersion ?? null,
    });
  }

  protected buildLogContext(context: TodayAnalysisContext): string {
    return context.date;
  }

  protected override async afterPersist(
    userId: string,
    data: TodayAnalysisDataDto,
  ): Promise<void> {
    const scope = {
      date: data.date,
      source: 'today-analysis',
    } as const;
    const notification = this.buildTodaySummaryNotification(data);

    await this.createNotificationSafely(userId, notification, scope);
    await this.deliverPushBestEffort(userId, notification);
  }

  private toVersionedDto(
    dto: GenerateTodayAnalysisDto,
    date: string,
    sourceVersion: number,
  ): InternalTodayAnalysisDto {
    return { date: dto.date ?? date, sourceVersion };
  }

  private async markFailedBestEffort(
    store: TodayAnalysisMaterializationStore,
    input: Parameters<TodayAnalysisMaterializationStore['markFailed']>[0],
  ): Promise<void> {
    try {
      await store.markFailed(input);
    } catch (cleanupError) {
      const message =
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError);
      const stack =
        cleanupError instanceof Error ? cleanupError.stack : undefined;
      this.logger.error(
        `Failed to mark Today analysis generation as failed: ${message}`,
        stack,
      );
    }
  }

  private buildTodaySummaryNotification(
    data: TodayAnalysisDataDto,
  ): CreateNotificationDto {
    return {
      type: 'ai_today_summary',
      title: 'AI 今日总结已生成',
      content: data.summary,
      action: data.action,
      actionPayload: {
        date: data.date,
        source: 'today-analysis',
      },
    };
  }

  private async deliverPushBestEffort(
    userId: string,
    notification: CreateNotificationDto,
  ): Promise<void> {
    try {
      await this.pushDeliveryService.sendToUser(userId, {
        title: notification.title,
        body: notification.content,
      });
    } catch (error) {
      const date =
        notification.actionPayload != null &&
        typeof notification.actionPayload === 'object' &&
        'date' in notification.actionPayload
          ? String(notification.actionPayload['date'])
          : 'unknown';
      this.logger.warn(
        `Failed to deliver push for user ${userId} (source=today-analysis, date=${date}): ${String(error)}`,
      );
    }
  }

  private async createNotificationSafely(
    userId: string,
    dto: CreateNotificationDto,
    scope: {
      source: string;
      date: string;
    },
  ): Promise<void> {
    try {
      await this.notificationsService.createOrReplaceScoped(userId, dto, scope);
    } catch (error) {
      this.logger.warn(
        `Failed to create scoped notification for user ${userId} (source=${scope.source}, date=${scope.date}): ${String(error)}`,
      );
    }
  }

  private async checkEmptyContext(
    userId: string,
    date: string,
    _language: string,
  ): Promise<TodayAnalysisReadDataDto | null> {
    const context = await this.contextService.build(userId, date);
    if (this.hasMeaningfulContext(context)) {
      return null;
    }

    const emptyStatus =
      this.materializationStore == null
        ? {
            status: 'empty' as const,
            sourceVersion: 0,
            computedVersion: 0,
            computedAt: null,
          }
        : await this.materializationStore.readStatus(userId, date);

    return {
      analysis: null,
      status: emptyStatus.status,
      sourceVersion: emptyStatus.sourceVersion,
      computedVersion: emptyStatus.computedVersion,
      computedAt: emptyStatus.computedAt?.toISOString() ?? null,
      retryAfterSeconds: emptyStatus.status === 'pending' ? 5 : null,
    };
  }

  private hasMeaningfulContext(context: TodayAnalysisContext): boolean {
    if (context.medication.medicineCount > 0) return true;
    if (context.lowRiskContext.activeAllergyCount > 0) return true;
    if (context.lowRiskContext.currentMedicineCount > 0) return true;

    const meaningfulKinds = new Set<string>([
      'water',
      'meal',
      'sleep',
      'mood',
      'symptom',
    ]);
    return context.recordSummary.some(
      (record) => meaningfulKinds.has(record.kind) && record.count > 0,
    );
  }
}

function isTodayAnalysisBulletKind(
  value: string,
): value is 'medication' | 'hydration' | 'sleep' | 'general' {
  return ['medication', 'hydration', 'sleep', 'general'].includes(value);
}
