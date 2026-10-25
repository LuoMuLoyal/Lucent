import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmCommonModule, StorageModule } from '../../common/index.js';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module.js';
import { PrismaModule } from '../../prisma/index.js';
import { HealthEventsModule } from '../health-events/health-events.module.js';
import { DailyRecordsController } from './adapters/http/daily-records.controller.js';
import { DailyRecordImageUploadService } from './adapters/http/image-upload.service.js';
import { SymptomCatalogService } from './adapters/http/symptom-catalog.service.js';
import { MealAnalysisQueue } from './adapters/queue/meal-analysis-queue.js';
import { MealAnalysisSweeper } from './adapters/queue/meal-analysis-sweeper.js';
import { AttachmentUrls } from './application/ports/attachment-urls.js';
import {
  CandidateCopyPort,
  CandidateGenerator,
} from './application/ports/candidate-generator.js';
import { MealAnalysisJobs } from './application/ports/meal-analysis-jobs.js';
import { MealVisionModel } from './application/ports/meal-vision.js';
import { DailyRecordReaderPort } from './application/ports/records-query.js';
import { DailyRecordCandidatesCopyService } from './application/services/candidate-copy.js';
import { HealthEventLink } from './application/services/health-event-link.js';
import { HealthEventOwnership } from './application/ports/health-events.js';
import { RecordChangeEvents } from './application/ports/record-change-events.js';
import { OutboxRecordChangeEvents } from './infrastructure/messaging/record-change-events.js';
import { HealthEventOwnershipAdapter } from './infrastructure/acl/health-event-ownership.js';
import { MealAnalysisPipeline } from './application/services/meal-analysis-pipeline.js';
import { RecordOwnership } from './application/services/record-ownership.js';
import { RecordWriteEffects } from './application/services/record-write-effects.js';
import { DailyRecordsService } from './application/services/records-facade.service.js';
import { CreateRecord } from './application/use_cases/create-record.js';
import { DeleteRecord } from './application/use_cases/delete-record.js';
import { DailyRecordCandidatesService } from './application/use_cases/generate-candidates.js';
import { GetRecord } from './application/use_cases/get-record.js';
import { GetSummary } from './application/use_cases/get-summary.js';
import { ListRecords } from './application/use_cases/list-records.js';
import { UpdateRecord } from './application/use_cases/update-record.js';
import { MealAnalyses } from './domain/meal/meal-analyses.js';
import { DailyRecords } from './domain/record/records.js';
import { BoundCandidateGenerator } from './infrastructure/llm/candidate-generator-binding.js';
import { DailyRecordCandidatesGeneratorService } from './infrastructure/llm/candidate-generator.js';
import { MealAnalysisVisionService } from './infrastructure/llm/meal-vision.js';
import { StorageAttachmentUrls } from './infrastructure/persistence/attachment-urls.js';
import { PrismaRecordQueries } from './infrastructure/persistence/record-queries.js';
import { PrismaRecords } from './infrastructure/persistence/records.js';

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
    // 持久化实现 → 领域 / 查询端口
    PrismaRecords,
    { provide: DailyRecords, useExisting: PrismaRecords },
    PrismaRecordQueries,
    { provide: DailyRecordReaderPort, useExisting: PrismaRecordQueries },
    { provide: MealAnalyses, useExisting: PrismaRecordQueries },
    StorageAttachmentUrls,
    { provide: AttachmentUrls, useExisting: StorageAttachmentUrls },

    // LLM 实现 → 端口
    MealAnalysisVisionService,
    { provide: MealVisionModel, useExisting: MealAnalysisVisionService },
    DailyRecordCandidatesGeneratorService,
    DailyRecordCandidatesCopyService,
    BoundCandidateGenerator,
    {
      provide: CandidateGenerator,
      useExisting: BoundCandidateGenerator,
    },
    {
      provide: CandidateCopyPort,
      useExisting: DailyRecordCandidatesCopyService,
    },

    // 队列适配器
    MealAnalysisQueue,
    { provide: MealAnalysisJobs, useExisting: MealAnalysisQueue },
    MealAnalysisSweeper,

    // 应用层编排
    MealAnalysisPipeline,
    OutboxRecordChangeEvents,
    { provide: RecordChangeEvents, useExisting: OutboxRecordChangeEvents },
    HealthEventOwnershipAdapter,
    { provide: HealthEventOwnership, useExisting: HealthEventOwnershipAdapter },
    HealthEventLink,
    RecordOwnership,
    RecordWriteEffects,
    CreateRecord,
    UpdateRecord,
    DeleteRecord,
    GetRecord,
    GetSummary,
    ListRecords,
    DailyRecordCandidatesService,
    DailyRecordsService,
    SymptomCatalogService,
    DailyRecordImageUploadService,
  ],
  exports: [
    DailyRecordReaderPort,
    MealAnalysisSweeper,
    DailyRecordsService,
    DailyRecordCandidatesService,
  ],
})
export class DailyRecordsModule {}
