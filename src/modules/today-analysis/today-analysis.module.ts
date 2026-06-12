import { Module } from '@nestjs/common';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { TodayAnalysisCopyService } from './today-analysis-copy.service';
import { TodayAnalysisController } from './today-analysis.controller';
import { TodayAnalysisContextService } from './today-analysis-context.service';
import { TodayAnalysisGeneratorService } from './today-analysis-generator.service';
import { TodayAnalysisPolicyService } from './today-analysis-policy.service';
import { TodayAnalysisService } from './today-analysis.service';

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
