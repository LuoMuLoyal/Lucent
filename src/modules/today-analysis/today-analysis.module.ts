import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { DailyRecordsModule } from '../daily-records/daily-records.module';
import { LlmCommonModule } from '../../common';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { MedicineDoseLogsModule } from '../medicine-dose-logs/medicine-dose-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TodayAnalysisContextService } from './services/context.service';

import { TodayAnalysisCopyService } from './services/copy.service';

import { TodayAnalysisGeneratorService } from './services/generator.service';

import { TodayAnalysisQueueService } from './services/analysis-queue.service';

import { TodayAnalysisService } from './services/analysis.service';

import { TodayRecommendationsService } from './services/recommendations.service';
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
