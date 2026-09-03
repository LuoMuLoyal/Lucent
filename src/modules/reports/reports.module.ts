import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module.js';
import { DailyRecordsModule } from '../daily-records/daily-records.module.js';
import { HealthEventsModule } from '../health-events/health-events.module.js';
import { LlmCommonModule } from '../../common/index.js';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module.js';
import { MedicinesModule } from '../medicines/medicines.module.js';
import { MedicineDoseLogsModule } from '../medicine-dose-logs/medicine-dose-logs.module.js';
import { UserSettingsModule } from '../user-settings/user-settings.module.js';
import { ProductEventsModule } from '../product-events/product-events.module.js';
import { ReportsAiSummaryContextService } from './services/ai-summary/context.service.js';

import { ReportsLlmSummaryCopyService } from './services/ai-summary/copy.service.js';

import { ReportsAiSummaryGeneratorService } from './services/ai-summary/generator.service.js';

import { ReportsAiSummaryService } from './services/ai-summary/summary.service.js';

import { ReportSummaryQueueService } from './services/ai-summary/summary-queue.service.js';
import { ClinicSummaryService } from './services/clinic-summary/summary.service.js';

import { ClinicSummaryPdfQueueService } from './services/clinic-summary/pdf-queue.service.js';

import { ClinicSummaryPdfService } from './services/clinic-summary/pdf.service.js';
import { ShareService } from './services/clinic-summary/share.service.js';
import { ReportsComputationService } from './dashboard/computation.service.js';

import { ReportsContextService } from './dashboard/context.service.js';

import { ReportsPresenterService } from './dashboard/presenter.service.js';

import { ReportsService } from './dashboard/dashboard.service.js';
import { ReportsCacheInvalidationListener } from './dashboard/cache-invalidation.listener.js';
import { EventReviewService } from './services/event-review/review.service.js';
import { EventReviewFactsService } from './services/event-review/facts.service.js';
import { EventReviewChangesService } from './services/event-review/changes.service.js';
import { EventReviewActionsService } from './services/event-review/actions.service.js';
import { EventReviewNextStepService } from './services/event-review/next-step.service.js';
import { ReportsController } from './reports.controller.js';
import { IReportSummaryReader } from './ports/report-summary-reader.port.js';

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
    ProductEventsModule,
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
    ShareService,
    ReportsComputationService,
    ReportsContextService,
    ReportsPresenterService,
    ReportsService,
    EventReviewService,
    EventReviewFactsService,
    EventReviewChangesService,
    EventReviewActionsService,
    EventReviewNextStepService,
    ReportsCacheInvalidationListener,
    { provide: IReportSummaryReader, useExisting: ReportsAiSummaryService },
  ],
  exports: [
    ReportsService,
    ReportsAiSummaryService,
    EventReviewService,
    IReportSummaryReader,
  ],
})
export class ReportsModule {}
