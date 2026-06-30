import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { ReportsAiSummaryContextService } from './services/reports-ai-summary-context.service';
import { ReportsAiSummaryCopyService } from './services/reports-ai-summary-copy.service';
import { ReportsAiSummaryGeneratorService } from './services/reports-ai-summary-generator.service';
import { AiSafetyPolicyService } from '../../common/ai/ai-safety-policy.service';
import { ReportsAiSummaryService } from './services/reports-ai-summary.service';
import { ReportsComputationService } from './dashboard/reports-computation.service';
import { ReportsContextService } from './dashboard/reports-context.service';
import { ReportsPresenterService } from './dashboard/reports-presenter.service';
import { ReportsService } from './dashboard/reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [LlmRuntimeModule, AssistantModule],
  controllers: [ReportsController],
  providers: [
    ReportsAiSummaryContextService,
    ReportsAiSummaryCopyService,
    ReportsAiSummaryGeneratorService,
    AiSafetyPolicyService,
    ReportsAiSummaryService,
    ReportsComputationService,
    ReportsContextService,
    ReportsPresenterService,
    ReportsService,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
