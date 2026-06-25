import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DailyRecordsModule } from '../daily-records/daily-records.module';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { MedicineRemindersModule } from '../medicine-reminders/medicine-reminders.module';
import { UserHealthContextModule } from '../user-health-context/user-health-context.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { AssistantRuntimeService } from './agent/assistant-runtime.service';
import { AssistantConversationService } from './services/assistant-conversation.service';
import { AssistantController } from './assistant.controller';
import { AssistantPolicyService } from './services/assistant-policy.service';
import { HistoricalAiSummaryService } from './services/historical-ai-summary.service';
import { AssistantService } from './assistant.service';
import {
  AssistantContextService,
  AssistantToolLeafletReadService,
  AssistantToolProposalService,
  AssistantToolReadService,
  AssistantToolRecordQueryService,
  AssistantToolService,
} from './tools';

@Module({
  imports: [
    AuthModule,
    LlmRuntimeModule,
    UserSettingsModule,
    UserHealthContextModule,
    DailyRecordsModule,
    MedicineRemindersModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantRuntimeService,
    AssistantConversationService,
    AssistantPolicyService,
    HistoricalAiSummaryService,
    AssistantContextService,
    AssistantToolRecordQueryService,
    AssistantToolProposalService,
    AssistantToolService,
    AssistantToolReadService,
    AssistantToolLeafletReadService,
    AssistantService,
  ],
  exports: [
    AssistantRuntimeService,
    AssistantPolicyService,
    HistoricalAiSummaryService,
    AssistantService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class AssistantModule {}
