import { Module } from '@nestjs/common';
import { AiChatModule } from '../ai-chat/ai-chat.module';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { ReportsAiSummaryContextService } from './services/reports-ai-summary-context.service';
import { ReportsAiSummaryCopyService } from './services/reports-ai-summary-copy.service';
import { ReportsAiSummaryGeneratorService } from './services/reports-ai-summary-generator.service';
import { ReportsAiSummaryPolicyService } from './services/reports-ai-summary-policy.service';
import { ReportsAiSummaryService } from './services/reports-ai-summary.service';
import { ReportsComputationService } from './dashboard/reports-computation.service';
import { ReportsContextService } from './dashboard/reports-context.service';
import { ReportsPresenterService } from './dashboard/reports-presenter.service';
import { ReportsService } from './dashboard/reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [LlmRuntimeModule, AiChatModule],
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
