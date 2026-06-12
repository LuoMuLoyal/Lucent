import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ResultCode } from '../../common/api-envelope';
import { PrismaService } from '../../prisma/prisma.service';
import type { GenerateTodayAnalysisDto, TodayAnalysisDataDto } from './dto';
import { TodayAnalysisCopyService } from './today-analysis-copy.service';
import {
  TodayAnalysisContextService,
  type TodayAnalysisContext,
} from './today-analysis-context.service';
import { TodayAnalysisGeneratorService } from './today-analysis-generator.service';
import { TodayAnalysisPolicyService } from './today-analysis-policy.service';
import type { TodayAnalysisStructuredOutput } from './schemas/today-analysis.schema';

@Injectable()
export class TodayAnalysisService {
  private readonly logger = new Logger(TodayAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contextService: TodayAnalysisContextService,
    private readonly policyService: TodayAnalysisPolicyService,
    private readonly copyService: TodayAnalysisCopyService,
    private readonly generatorService: TodayAnalysisGeneratorService,
  ) {}

  async generate(
    userId: string,
    dto: GenerateTodayAnalysisDto,
    language: string,
  ): Promise<TodayAnalysisDataDto> {
    const locale = this.copyService.resolveLocale(language);
    await this.assertAiSummariesEnabled(userId, locale);

    const date = dto.date ?? this.todayUtcDateString();
    const context = await this.contextService.build(userId, date);
    const generatedAt = new Date().toISOString();

    if (!this.generatorService.hasAnalysisModel()) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.copyService.serviceUnavailable(locale),
      });
    }

    const output = await this.generateStructuredOutput(context, locale);

    return {
      date,
      generatedAt,
      summary: output.summary,
      bullets: output.bullets,
      actionLabel: output.actionLabel,
      confidenceNote: output.confidenceNote,
    };
  }

  private async assertAiSummariesEnabled(
    userId: string,
    locale: string,
  ): Promise<void> {
    const setting = await this.prisma.userSetting.findFirst({
      where: {
        userId,
        key: 'aiSummariesEnabled',
      },
      select: {
        value: true,
      },
    });

    if (setting?.value === false) {
      throw new ForbiddenException({
        code: ResultCode.FORBIDDEN,
        message: this.copyService.summariesDisabled(locale),
      });
    }
  }

  private async generateStructuredOutput(
    context: TodayAnalysisContext,
    locale: string,
  ): Promise<TodayAnalysisStructuredOutput> {
    try {
      const raw = await this.invokeModel(context, locale);
      if (this.policyService.isSafe(raw)) {
        return raw;
      }

      this.logger.warn(
        `Today analysis policy rejected model output for ${context.date}; falling back`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Today analysis model generation failed for ${context.date}; falling back: ${reason}`,
      );
    }

    return this.copyService.buildFallback(context, locale);
  }

  private async invokeModel(
    context: TodayAnalysisContext,
    locale: string,
  ): Promise<TodayAnalysisStructuredOutput> {
    return this.generatorService.generate(
      context,
      this.copyService.buildPromptCopy(locale),
    );
  }

  private todayUtcDateString(): string {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    )
      .toISOString()
      .slice(0, 10);
  }
}
