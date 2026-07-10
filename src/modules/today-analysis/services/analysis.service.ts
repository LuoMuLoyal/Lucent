import { Injectable, Logger } from '@nestjs/common';

import { now } from '../../../common/helpers/date-time.utils';
import type { CreateNotificationDto } from '../../notifications/dto';
import { HistoricalAiSummaryService } from '../../assistant/services/historical-ai-summary.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BaseLlmSummaryService } from '../../../common/llm/base-llm-summary.service';
import { LlmSafetyPolicyService } from '../../../common/llm/llm-safety-policy.service';
import type { GenerateTodayAnalysisDto, TodayAnalysisDataDto } from '../dto';
import { TodayAnalysisCopyService } from './copy.service';
import {
  TodayAnalysisContextService,
  type TodayAnalysisContext,
} from './context.service';
import { TodayAnalysisGeneratorService } from './generator.service';
import type { TodayAnalysisStructuredOutput } from '../schemas/analysis.schema';
import { nowIsoString } from '../../../common/helpers/date-time.utils';

interface PreparedTodayAnalysis {
  context: TodayAnalysisContext;
  locale: string;
  metadata: string;
}

@Injectable()
export class TodayAnalysisService extends BaseLlmSummaryService<
  TodayAnalysisContext,
  TodayAnalysisStructuredOutput,
  TodayAnalysisDataDto,
  GenerateTodayAnalysisDto,
  string
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
  ) {
    super(prisma, copyService, generatorService, policyService);
  }

  protected async prepare(
    userId: string,
    dto: GenerateTodayAnalysisDto,
    locale: string,
  ): Promise<PreparedTodayAnalysis> {
    const date = dto.date ?? this.todayUtcDateString();
    const context = await this.contextService.build(userId, date);
    const generatedAt = nowIsoString();

    return {
      locale,
      context,
      metadata: generatedAt,
    };
  }

  protected toDataDto(
    context: TodayAnalysisContext,
    output: TodayAnalysisStructuredOutput,
    generatedAt: string,
  ): TodayAnalysisDataDto {
    return {
      date: context.date,
      generatedAt,
      summary: output.summary,
      bullets: output.bullets,
      actionLabel: output.actionLabel,
      action: output.action,
      confidenceNote: output.confidenceNote,
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

    await this.createNotificationSafely(
      userId,
      this.buildTodaySummaryNotification(data),
      scope,
    );
    await this.createNotificationSafely(
      userId,
      this.buildProactiveSuggestionNotification(data),
      scope,
    );
  }

  private todayUtcDateString(): string {
    const currentTime = now();
    return new Date(
      Date.UTC(
        currentTime.getUTCFullYear(),
        currentTime.getUTCMonth(),
        currentTime.getUTCDate(),
      ),
    )
      .toISOString()
      .slice(0, 10);
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

  private buildProactiveSuggestionNotification(
    data: TodayAnalysisDataDto,
  ): CreateNotificationDto {
    return {
      type: 'ai_proactive_suggestion',
      title: 'AI 主动建议',
      content: data.bullets[0]?.text ?? data.summary,
      action: data.action,
      actionPayload: {
        date: data.date,
        source: 'today-analysis',
        actionLabel: data.actionLabel,
      },
    };
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
    } catch {
      // Silently fail so notification issues do not break analysis generation.
    }
  }
}
