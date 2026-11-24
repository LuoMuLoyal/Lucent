import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module.js';
import { RecordModule } from '../record/record.module.js';
import { LlmCommonModule } from '../../common/index.js';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module.js';
import { DoseModule } from '../dose/dose.module.js';
import { ReminderModule } from '../reminder/reminder.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ContextModule } from '../context/context.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { PrismaModule } from '../../prisma/index.js';
import { AnalysisContextService } from './adapters/acl/analysis-context.js';
import { TriggerEvaluatorService } from './application/services/trigger-evaluator.js';

import { AnalysisCopyService } from './application/services/analysis-copy.js';

import { AnalysisGeneratorService } from './infrastructure/llm/analysis-generator.js';

import { AnalysisQueueService } from './adapters/queue/analysis.js';

import { AnalysisService } from './application/use_cases/generate-analysis.js';
import { AnalysisMaterializationStore } from './infrastructure/persistence/materialization.js';
import { AnalysisEventConsumerService } from './adapters/queue/event-consumer.js';
import { ANALYSIS_QUEUE_PORT } from './application/ports/analysis-queue.js';
import { ANALYSIS_MATERIALIZATION } from './application/ports/materialization.js';
import {
  ANALYSIS_CONTEXT_SOURCE,
  ANALYSIS_GENERATOR,
} from './application/ports/analysis-pipeline.js';

import { TodayRecommendationsService } from './application/read_models/recommendations.js';
import { AnalysisController } from './adapters/http/controllers/analysis.controller.js';

@Module({
  imports: [
    LlmRuntimeModule,
    LlmCommonModule,
    AssistantModule,
    NotificationsModule,
    PrismaModule,
    RecordModule,
    DoseModule,
    ReminderModule,
    ContextModule,
    SettingsModule,
  ],
  controllers: [AnalysisController],
  providers: [
    AnalysisCopyService,
    AnalysisContextService,
    TriggerEvaluatorService,
    AnalysisGeneratorService,
    AnalysisService,
    AnalysisQueueService,
    AnalysisMaterializationStore,
    AnalysisEventConsumerService,
    {
      provide: ANALYSIS_MATERIALIZATION,
      useExisting: AnalysisMaterializationStore,
    },
    {
      provide: ANALYSIS_CONTEXT_SOURCE,
      useExisting: AnalysisContextService,
    },
    {
      provide: ANALYSIS_GENERATOR,
      useExisting: AnalysisGeneratorService,
    },
    {
      provide: ANALYSIS_QUEUE_PORT,
      useExisting: AnalysisQueueService,
    },
    TodayRecommendationsService,
  ],
})
export class AnalysisModule {}
