import { Module } from '@nestjs/common';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { TodayAnalysisCopyService } from './analysis/today-analysis-copy.service';
import { TodayAnalysisController } from './today-analysis.controller';
import { TodayAnalysisContextService } from './analysis/today-analysis-context.service';
import { TodayAnalysisGeneratorService } from './analysis/today-analysis-generator.service';
import { TodayAnalysisPolicyService } from './analysis/today-analysis-policy.service';
import { TodayAnalysisService } from './analysis/today-analysis.service';

@Module({
  imports: [LlmRuntimeModule],
  controllers: [TodayAnalysisController],
  providers: [
    TodayAnalysisCopyService,
    TodayAnalysisContextService,
    TodayAnalysisGeneratorService,
    TodayAnalysisPolicyService,
    TodayAnalysisService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class TodayAnalysisModule {}
