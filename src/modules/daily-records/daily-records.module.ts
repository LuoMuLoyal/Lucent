import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmCommonModule } from '../../common/index.js';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module.js';
import { PrismaModule } from '../../prisma/index.js';
import { StorageModule } from '../../common/index.js';
import { HealthEventsModule } from '../health-events/health-events.module.js';
import {
  DailyRecordReaderPort,
  DailyRecordRepository,
  DailyRecordRepositoryPort,
} from './repositories/daily-record.repository.js';
import { DailyRecordCandidatesCopyService } from './services/candidates/copy.service.js';
import { DailyRecordCandidatesGeneratorService } from './services/candidates/generator.service.js';
import { DailyRecordCandidatesService } from './services/candidates/orchestrator.service.js';
import { DailyRecordsOwnershipService } from './services/ownership.service.js';
import { DailyRecordImageUploadService } from './services/image-upload.service.js';
import { DailyRecordsController } from './daily-records.controller.js';
import { DailyRecordsMapperService } from './services/mapper.service.js';
import { DailyRecordsService } from './services/records.service.js';
import { MealAnalysisQueueService } from './services/meal-analysis/queue.service.js';
import { MealAnalysisMatcherService } from './services/meal-analysis/matcher.service.js';
import { MealAnalysisVisionService } from './services/meal-analysis/vision.service.js';
import { MealAnalysisWorkerService } from './services/meal-analysis/worker.service.js';
import { MealDishDecompositionService } from './services/meal-dish/decomposition.service.js';
import { MealIngredientGroundingService } from './services/meal-ingredient/grounding.service.js';
import { MealDishTemplateLearningService } from './services/meal-dish/template-learning.service.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    LlmRuntimeModule,
    StorageModule,
    LlmCommonModule,
    HealthEventsModule,
  ],
  controllers: [DailyRecordsController],
  providers: [
    DailyRecordRepository,
    {
      provide: DailyRecordRepositoryPort,
      useExisting: DailyRecordRepository,
    },
    {
      provide: DailyRecordReaderPort,
      useExisting: DailyRecordRepository,
    },
    DailyRecordCandidatesCopyService,
    DailyRecordCandidatesGeneratorService,
    DailyRecordCandidatesService,
    DailyRecordsOwnershipService,
    DailyRecordsService,
    DailyRecordsMapperService,
    MealAnalysisQueueService,
    MealAnalysisMatcherService,
    MealDishDecompositionService,
    MealIngredientGroundingService,
    MealDishTemplateLearningService,
    MealAnalysisVisionService,
    MealAnalysisWorkerService,
    DailyRecordImageUploadService,
  ],
  exports: [
    DailyRecordsService,
    DailyRecordCandidatesService,
    DailyRecordReaderPort,
  ],
})
export class DailyRecordsModule {}
