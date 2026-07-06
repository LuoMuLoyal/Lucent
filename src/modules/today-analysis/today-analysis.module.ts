import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TodayAnalysisCopyService } from './services/copy.service';
import { TodayAnalysisController } from './today-analysis.controller';
import { TodayAnalysisContextService } from './services/context.service';
import { TodayAnalysisGeneratorService } from './services/generator.service';
import { AiSafetyPolicyService } from '../../common/ai/ai-safety-policy.service';
import { TodayAnalysisService } from './services/analysis.service';
import { TodayRecommendationsService } from './services/recommendations.service';

@Module({
  imports: [LlmRuntimeModule, AssistantModule, NotificationsModule],
  controllers: [TodayAnalysisController],
  providers: [
    TodayAnalysisCopyService,
    TodayAnalysisContextService,
    TodayAnalysisGeneratorService,
    AiSafetyPolicyService,
    TodayAnalysisService,
    TodayRecommendationsService,
  ],
})
export class TodayAnalysisModule {}
