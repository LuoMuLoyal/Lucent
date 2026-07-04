import { Injectable, Logger } from '@nestjs/common';

import { now } from '../../../common/utils/date-time.utils';
import { HistoricalAiSummaryService } from '../../assistant/services/historical-ai-summary.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BaseAiSummaryService } from '../../../common/ai/base-ai-summary.service';
import { AiSafetyPolicyService } from '../../../common/ai/ai-safety-policy.service';
import type { GenerateTodayAnalysisDto, TodayAnalysisDataDto } from '../dto';
import { TodayAnalysisCopyService } from './today-analysis-copy.service';
import {
  TodayAnalysisContextService,
  type TodayAnalysisContext,
} from './today-analysis-context.service';
import { TodayAnalysisGeneratorService } from './today-analysis-generator.service';
import type { TodayAnalysisStructuredOutput } from '../schemas/today-analysis.schema';
import { nowIsoString } from '../../../common/utils/date-time.utils';

interface PreparedTodayAnalysis {
  context: TodayAnalysisContext;
  locale: string;
  generatedAt: string;
}

@Injectable()
export class TodayAnalysisService extends BaseAiSummaryService<
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
    policyService: AiSafetyPolicyService,
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
      generatedAt,
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
    try {
      await this.notificationsService.create(userId, {
        type: 'ai_today_summary',
        title: 'AI 今日总结已生成',
        content: data.summary,
        action: 'today',
      });
    } catch {
      // Silently fail so notification issues do not break analysis generation.
    }
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
}
