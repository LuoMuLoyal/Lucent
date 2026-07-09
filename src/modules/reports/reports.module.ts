import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { ReportsAiSummaryContextService } from './services/ai-summary/context.service';
import { ReportsLlmSummaryCopyService } from './services/ai-summary/copy.service';
import { ReportsAiSummaryGeneratorService } from './services/ai-summary/generator.service';
import { LlmSafetyPolicyService } from '../../common/llm/llm-safety-policy.service';
import { ReportsAiSummaryService } from './services/ai-summary/summary.service';
import { ClinicSummaryService } from './services/clinic-summary/summary.service';
import { ClinicSummaryPdfService } from './services/clinic-summary/pdf.service';
import { ReportsComputationService } from './dashboard/computation.service';
import { ReportsContextService } from './dashboard/context.service';
import { ReportsPresenterService } from './dashboard/presenter.service';
import { ReportsService } from './dashboard/dashboard.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [LlmRuntimeModule, AssistantModule],
  controllers: [ReportsController],
  providers: [
    ReportsAiSummaryContextService,
    ReportsLlmSummaryCopyService,
    ReportsAiSummaryGeneratorService,
    LlmSafetyPolicyService,
    ReportsAiSummaryService,
    ClinicSummaryService,
    ClinicSummaryPdfService,
    ReportsComputationService,
    ReportsContextService,
    ReportsPresenterService,
    ReportsService,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
