import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { DailyRecordsModule } from '../daily-records/daily-records.module';
import { LlmCommonModule } from '../../common/llm';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { MedicineDoseLogsModule } from '../medicine-dose-logs/medicine-dose-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  TodayAnalysisContextService,
  TodayAnalysisCopyService,
  TodayAnalysisGeneratorService,
  TodayAnalysisQueueService,
  TodayAnalysisService,
  TodayRecommendationsService,
} from './services';
import { TodayAnalysisController } from './today-analysis.controller';

@Module({
  imports: [
    LlmRuntimeModule,
    LlmCommonModule,
    AssistantModule,
    NotificationsModule,
    DailyRecordsModule,
    MedicineDoseLogsModule,
  ],
  controllers: [TodayAnalysisController],
  providers: [
    TodayAnalysisCopyService,
    TodayAnalysisContextService,
    TodayAnalysisGeneratorService,
    TodayAnalysisService,
    TodayAnalysisQueueService,
    TodayRecommendationsService,
  ],
})
export class TodayAnalysisModule {}
