import { Module } from '@nestjs/common';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { ReportsAiSummaryContextService } from './ai-summary/reports-ai-summary-context.service';
import { ReportsAiSummaryCopyService } from './ai-summary/reports-ai-summary-copy.service';
import { ReportsAiSummaryGeneratorService } from './ai-summary/reports-ai-summary-generator.service';
import { ReportsAiSummaryPolicyService } from './ai-summary/reports-ai-summary-policy.service';
import { ReportsAiSummaryService } from './ai-summary/reports-ai-summary.service';
import { ReportsComputationService } from './dashboard/reports-computation.service';
import { ReportsContextService } from './dashboard/reports-context.service';
import { ReportsPresenterService } from './dashboard/reports-presenter.service';
import { ReportsService } from './dashboard/reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [LlmRuntimeModule],
  controllers: [ReportsController],
  providers: [
    ReportsAiSummaryContextService,
    ReportsAiSummaryCopyService,
    ReportsAiSummaryGeneratorService,
    ReportsAiSummaryPolicyService,
    ReportsAiSummaryService,
    ReportsComputationService,
    ReportsContextService,
    ReportsPresenterService,
    ReportsService,
  ],
  exports: [ReportsService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class ReportsModule {}
