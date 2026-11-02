import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module.js';
import { DailyRecordsModule } from '../daily-records/daily-records.module.js';
import { LlmCommonModule } from '../../common/index.js';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module.js';
import { MedicineDoseLogsModule } from '../medicine-dose-logs/medicine-dose-logs.module.js';
import { MedicineRemindersModule } from '../medicine-reminders/medicine-reminders.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { UserHealthContextModule } from '../user-health-context/user-health-context.module.js';
import { UserSettingsModule } from '../user-settings/user-settings.module.js';
import { PrismaModule } from '../../prisma/index.js';
import { TodayAnalysisContextService } from './adapters/acl/analysis-context.js';
import { TriggerEvaluatorService } from './application/services/trigger-evaluator.js';

import { TodayAnalysisCopyService } from './application/services/analysis-copy.js';

import { TodayAnalysisGeneratorService } from './infrastructure/llm/analysis-generator.js';

import { TodayAnalysisQueueService } from './adapters/queue/analysis.js';

import { TodayAnalysisService } from './application/use_cases/generate-today-analysis.js';
import { TodayAnalysisMaterializationStore } from './infrastructure/persistence/materialization.js';
import { TodayAnalysisEventConsumerService } from './adapters/queue/event-consumer.js';
import { TODAY_ANALYSIS_QUEUE_PORT } from './application/ports/analysis-queue.js';
import { TODAY_ANALYSIS_MATERIALIZATION } from './application/ports/materialization.js';
import {
  ANALYSIS_CONTEXT_SOURCE,
  ANALYSIS_GENERATOR,
} from './application/ports/analysis-pipeline.js';

import { TodayRecommendationsService } from './application/read_models/recommendations.js';
import { TodayAnalysisController } from './adapters/http/controllers/today-analysis.controller.js';

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
    UserHealthContextModule,
    UserSettingsModule,
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
      provide: ANALYSIS_CONTEXT_SOURCE,
      useExisting: TodayAnalysisContextService,
    },
    {
      provide: ANALYSIS_GENERATOR,
      useExisting: TodayAnalysisGeneratorService,
    },
    {
      provide: TODAY_ANALYSIS_QUEUE_PORT,
      useExisting: TodayAnalysisQueueService,
    },
    TodayRecommendationsService,
  ],
})
export class TodayAnalysisModule {}
