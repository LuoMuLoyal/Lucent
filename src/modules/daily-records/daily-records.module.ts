import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { DailyRecordCandidatesCopyService } from './services/daily-record-candidates-copy.service';
import { DailyRecordCandidatesGeneratorService } from './services/daily-record-candidates-generator.service';
import { DailyRecordCandidatesService } from './services/daily-record-candidates.service';
import { DailyRecordsOwnershipService } from './services/ownership.service';
import { DailyRecordImageUploadService } from './services/daily-record-image-upload.service';
import { DailyRecordImageUploadRuntime } from './config/daily-record-image-upload.runtime';
import { DailyRecordsController } from './daily-records.controller';
import { DailyRecordsMapperService } from './services/daily-records-mapper.service';
import { DailyRecordsService } from './services/daily-records.service';
import { MealAnalysisQueueService } from './services/meal-analysis-queue.service';
import { MealAnalysisVisionService } from './services/meal-analysis-vision.service';
import { MealAnalysisWorkerService } from './services/meal-analysis-worker.service';

@Module({
  imports: [ConfigModule, PrismaModule, LlmRuntimeModule],
  controllers: [DailyRecordsController],
  providers: [
    DailyRecordCandidatesCopyService,
    DailyRecordCandidatesGeneratorService,
    DailyRecordCandidatesService,
    DailyRecordsOwnershipService,
    DailyRecordsService,
    DailyRecordsMapperService,
    MealAnalysisQueueService,
    MealAnalysisVisionService,
    MealAnalysisWorkerService,
    DailyRecordImageUploadRuntime,
    DailyRecordImageUploadService,
  ],
  exports: [
    DailyRecordsService,
    DailyRecordCandidatesService,
    DailyRecordImageUploadRuntime,
  ],
})
export class DailyRecordsModule {}
