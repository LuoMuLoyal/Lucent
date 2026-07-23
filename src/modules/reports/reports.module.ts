import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { DailyRecordsModule } from '../daily-records/daily-records.module';
import { LlmCommonModule } from '../../common/llm';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { MedicineDoseLogsModule } from '../medicine-dose-logs/medicine-dose-logs.module';
import {
  ReportsAiSummaryContextService,
  ReportsLlmSummaryCopyService,
  ReportsAiSummaryGeneratorService,
  ReportsAiSummaryService,
  ReportSummaryQueueService,
} from './services/ai-summary';
import {
  ClinicSummaryService,
  ClinicSummaryPdfQueueService,
  ClinicSummaryPdfService,
} from './services/clinic-summary';
import {
  ReportsComputationService,
  ReportsContextService,
  ReportsPresenterService,
  ReportsService,
} from './dashboard';
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
