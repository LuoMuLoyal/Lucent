import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TodayAnalysisCopyService } from './services/today-analysis-copy.service';
import { TodayAnalysisController } from './today-analysis.controller';
import { TodayAnalysisContextService } from './services/today-analysis-context.service';
import { TodayAnalysisGeneratorService } from './services/today-analysis-generator.service';
import { TodayAnalysisPolicyService } from './services/today-analysis-policy.service';
import { TodayAnalysisService } from './services/today-analysis.service';

@Module({
  imports: [LlmRuntimeModule, AssistantModule, NotificationsModule],
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
