import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module.js';
import { DailyRecordsModule } from '../daily-records/daily-records.module.js';
import { LlmCommonModule } from '../../common/index.js';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module.js';
import { MedicineDoseLogsModule } from '../medicine-dose-logs/medicine-dose-logs.module.js';
import { MedicineRemindersModule } from '../medicine-reminders/medicine-reminders.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PrismaModule } from '../../prisma/index.js';
import { TodayAnalysisContextService } from './services/pipeline/context.service.js';
import { TriggerEvaluatorService } from './services/pipeline/trigger-evaluator.service.js';

import { TodayAnalysisCopyService } from './services/pipeline/copy.service.js';

import { TodayAnalysisGeneratorService } from './services/pipeline/generator.service.js';

import { TodayAnalysisQueueService } from './services/analysis-queue.service.js';

import { TodayAnalysisService } from './services/analysis.service.js';
import { TodayAnalysisMaterializationStore } from './infrastructure/persistence/materialization.js';
import { TodayAnalysisEventConsumerService } from './adapters/queue/event-consumer.js';
import { TODAY_ANALYSIS_QUEUE_PORT } from './application/ports/analysis-queue.js';
import { TODAY_ANALYSIS_MATERIALIZATION } from './application/ports/materialization.js';

import { TodayRecommendationsService } from './services/pipeline/recommendations.service.js';
import { TodayAnalysisController } from './today-analysis.controller.js';

@Module({
  imports: [
    LlmRuntimeModule,
    LlmCommonModule,
    AssistantModule,
    NotificationsModule,
    PrismaModule,
    DailyRecordsModule,
    MedicineDoseLogsModule,
    MedicineRemindersModule,
  ],
  controllers: [TodayAnalysisController],
  providers: [
    TodayAnalysisCopyService,
    TodayAnalysisContextService,
    TriggerEvaluatorService,
    TodayAnalysisGeneratorService,
    TodayAnalysisService,
    TodayAnalysisQueueService,
    TodayAnalysisMaterializationStore,
    TodayAnalysisEventConsumerService,
    {
      provide: TODAY_ANALYSIS_MATERIALIZATION,
      useExisting: TodayAnalysisMaterializationStore,
    },
    {
      provide: TODAY_ANALYSIS_QUEUE_PORT,
      useExisting: TodayAnalysisQueueService,
    },
    TodayRecommendationsService,
  ],
})
export class TodayAnalysisModule {}
