import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmCommonModule } from '../../common/llm';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { PrismaModule } from '../../prisma';
import { StorageModule } from '../../common/storage';
import {
  DailyRecordReaderPort,
  DailyRecordRepository,
  DailyRecordRepositoryPort,
} from './repositories';
import { DailyRecordCandidatesCopyService } from './services/candidates';
import { DailyRecordCandidatesGeneratorService } from './services/candidates';
import { DailyRecordCandidatesService } from './services/candidates/service';
import { DailyRecordsOwnershipService } from './services';
import { DailyRecordImageUploadService } from './services';
import { DailyRecordsController } from './daily-records.controller';
import { DailyRecordsMapperService } from './services';
import { DailyRecordsService } from './services';
import { MealAnalysisQueueService } from './services/meal-analysis';
import { MealAnalysisMatcherService } from './services/meal-analysis';
import { MealAnalysisVisionService } from './services/meal-analysis';
import { MealAnalysisWorkerService } from './services/meal-analysis';
import { MealDishDecompositionService } from './services/meal-dish';
import { MealIngredientGroundingService } from './services/meal-ingredient';
import { MealDishTemplateLearningService } from './services/meal-dish';

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
