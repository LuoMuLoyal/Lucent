import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { DailyRecordsModule } from '../daily-records/daily-records.module';
import { HealthEventsModule } from '../health-events/health-events.module';
import { LlmCommonModule } from '../../common';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { MedicinesModule } from '../medicines/medicines.module';
import { MedicineDoseLogsModule } from '../medicine-dose-logs/medicine-dose-logs.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { ReportsAiSummaryContextService } from './services/ai-summary/context.service';

import { ReportsLlmSummaryCopyService } from './services/ai-summary/copy.service';

import { ReportsAiSummaryGeneratorService } from './services/ai-summary/generator.service';

import { ReportsAiSummaryService } from './services/ai-summary/summary.service';

import { ReportSummaryQueueService } from './services/ai-summary/summary-queue.service';
import { ClinicSummaryService } from './services/clinic-summary/summary.service';

import { ClinicSummaryPdfQueueService } from './services/clinic-summary/pdf-queue.service';

import { ClinicSummaryPdfService } from './services/clinic-summary/pdf.service';
import { ReportsComputationService } from './dashboard/computation.service';

import { ReportsContextService } from './dashboard/context.service';

import { ReportsPresenterService } from './dashboard/presenter.service';

import { ReportsService } from './dashboard/dashboard.service';
import { EventReviewService } from './services/event-review/review.service';
import { EventReviewFactsService } from './services/event-review/facts.service';
import { EventReviewChangesService } from './services/event-review/changes.service';
import { EventReviewActionsService } from './services/event-review/actions.service';
import { EventReviewNextStepService } from './services/event-review/next-step.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    LlmRuntimeModule,
    LlmCommonModule,
    AssistantModule,
    DailyRecordsModule,
    HealthEventsModule,
    MedicinesModule,
    MedicineDoseLogsModule,
    UserSettingsModule,
  ],
  controllers: [ReportsController],
  providers: [
    ReportsAiSummaryContextService,
    ReportsLlmSummaryCopyService,
    ReportsAiSummaryGeneratorService,
    ReportsAiSummaryService,
    ReportSummaryQueueService,
    ClinicSummaryService,
    ClinicSummaryPdfQueueService,
    ClinicSummaryPdfService,
    ReportsComputationService,
    ReportsContextService,
    ReportsPresenterService,
    ReportsService,
    EventReviewService,
    EventReviewFactsService,
    EventReviewChangesService,
    EventReviewActionsService,
    EventReviewNextStepService,
  ],
  exports: [ReportsService, EventReviewService],
})
export class ReportsModule {}
