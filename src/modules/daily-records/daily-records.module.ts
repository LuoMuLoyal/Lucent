import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmCommonModule } from '../../common/llm';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../../common/storage';
import {
  DailyRecordReaderPort,
  DailyRecordRepository,
  DailyRecordRepositoryPort,
} from './repositories';
import { DailyRecordCandidatesCopyService } from './services/candidates/copy.service';
import { DailyRecordCandidatesGeneratorService } from './services/candidates/generator.service';
import { DailyRecordCandidatesService } from './services/candidates/service';
import { DailyRecordsOwnershipService } from './services/ownership.service';
import { DailyRecordImageUploadService } from './services/image-upload.service';
import { DailyRecordsController } from './daily-records.controller';
import { DailyRecordsMapperService } from './services/mapper.service';
import { DailyRecordsService } from './services/records.service';
import { MealAnalysisQueueService } from './services/meal-analysis/queue.service';
import { MealAnalysisMatcherService } from './services/meal-analysis/matcher.service';
import { MealAnalysisVisionService } from './services/meal-analysis/vision.service';
import { MealAnalysisWorkerService } from './services/meal-analysis/worker.service';
import { MealDishDecompositionService } from './services/meal-dish/decomposition.service';
import { MealIngredientGroundingService } from './services/meal-ingredient/grounding.service';
import { MealDishTemplateLearningService } from './services/meal-dish/template-learning.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    LlmRuntimeModule,
    StorageModule,
    LlmCommonModule,
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
