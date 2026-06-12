import { Module } from '@nestjs/common';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { ReportsAiSummaryContextService } from './reports-ai-summary-context.service';
import { ReportsAiSummaryCopyService } from './reports-ai-summary-copy.service';
import { ReportsAiSummaryGeneratorService } from './reports-ai-summary-generator.service';
import { ReportsAiSummaryPolicyService } from './reports-ai-summary-policy.service';
import { ReportsAiSummaryService } from './reports-ai-summary.service';
import { ReportsController } from './reports.controller';
import { ReportsComputationService } from './reports-computation.service';
import { ReportsContextService } from './reports-context.service';
import { ReportsPresenterService } from './reports-presenter.service';
import { ReportsService } from './reports.service';

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
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class ReportsModule {}
