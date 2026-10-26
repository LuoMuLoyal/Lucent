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
import { ReportsAiSummaryContextService } from './application/read_models/ai-summary/summary-context.js';

import { ReportsLlmSummaryCopyService } from './application/services/summary-copy.js';

import { ReportsAiSummaryGeneratorService } from './infrastructure/llm/summary-generator.js';

import { ReportsAiSummaryService } from './application/use_cases/generate-report-summary.js';

import { ReportSummaryQueueService } from './adapters/queue/summary.js';
import { ClinicSummaryService } from './services/clinic-summary/summary.service.js';

import { ClinicSummaryPdfQueueService } from './services/clinic-summary/pdf-queue.service.js';

import { ClinicSummaryPdfService } from './services/clinic-summary/pdf.service.js';
import { ShareService } from './services/clinic-summary/share.service.js';
import { ReportsComputationService } from './application/read_models/dashboard/dashboard-computation.js';

import { ReportsContextService } from './adapters/acl/dashboard-context.js';

import { ReportsPresenterService } from './application/read_models/dashboard/dashboard-presenter.js';

import { ReportsService } from './application/use_cases/get-dashboard.js';
import { ReportsCacheInvalidationQueueService } from './adapters/queue/cache-invalidation.js';
import { EventReviewService } from './application/read_models/event-review/review.js';
import { EventReviewFactsService } from './application/read_models/event-review/facts.js';
import { EventReviewChangesService } from './application/read_models/event-review/changes.js';
import { EventReviewActionsService } from './application/read_models/event-review/actions.js';
import { EventReviewNextStepService } from './application/read_models/event-review/next-step.js';
import { ReportsController } from './reports.controller.js';
import { ClinicSummaryController } from './clinic-summary.controller.js';
import { EventReviewController } from './adapters/http/controllers/event-review.controller.js';
import { IReportSummaryReader } from './ports/report-summary-reader.port.js';
import { REPORT_DASHBOARD_CONTEXT } from './application/ports/dashboard.js';
import { REPORT_SUMMARY_GENERATOR } from './application/ports/summary.js';

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
  controllers: [
    ReportsController,
    ClinicSummaryController,
    EventReviewController,
  ],
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
    ReportsCacheInvalidationQueueService,
    {
      provide: REPORT_DASHBOARD_CONTEXT,
      useExisting: ReportsContextService,
    },
    {
      provide: REPORT_SUMMARY_GENERATOR,
      useExisting: ReportsAiSummaryGeneratorService,
    },
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
