import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { DailyRecordsModule } from '../daily-records/daily-records.module';
import { LlmCommonModule } from '../../common';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { MedicineDoseLogsModule } from '../medicine-dose-logs/medicine-dose-logs.module';
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
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    LlmRuntimeModule,
    LlmCommonModule,
    AssistantModule,
    DailyRecordsModule,
    MedicineDoseLogsModule,
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
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
