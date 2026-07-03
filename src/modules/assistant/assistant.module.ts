import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DailyRecordCandidatesService } from '../daily-records/services/daily-record-candidates.service';
import { DailyRecordsService } from '../daily-records/services/daily-records.service';
import { DailyRecordsModule } from '../daily-records/daily-records.module';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { MedicineRemindersModule } from '../medicine-reminders/medicine-reminders.module';
import { MedicineRemindersService } from '../medicine-reminders/services/medicine-reminders.service';
import { MedicinesModule } from '../medicines/medicines.module';
import { UserHealthContextModule } from '../user-health-context/user-health-context.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { AssistantRuntimeService } from './agent/assistant-runtime.service';
import { AssistantConversationService } from './services/assistant-conversation.service';
import { AssistantController } from './assistant.controller';
import { AssistantPolicyService } from './services/assistant-policy.service';
import { HistoricalAiSummaryService } from './services/historical-ai-summary.service';
import { AssistantService } from './services/assistant.service';
import {
  DAILY_RECORD_CANDIDATE_GENERATOR,
  DAILY_RECORD_READER,
  MEDICINE_REMINDER_READER,
} from './types/assistant-ports';
import {
  AssistantContextService,
  AssistantToolDrugbankEntityResolveService,
  AssistantToolDrugbankSearchService,
  AssistantToolLeafletReadService,
  AssistantToolMedicalKnowledgeService,
  AssistantToolMedicineLookupService,
  AssistantToolProposalService,
  AssistantToolReadService,
  AssistantToolRecordQueryService,
  AssistantToolService,
} from './tools';

@Module({
  imports: [
    AuthModule,
    LlmRuntimeModule,
    MedicinesModule,
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
    AssistantToolMedicalKnowledgeService,
    AssistantToolMedicineLookupService,
    AssistantToolDrugbankEntityResolveService,
    AssistantToolDrugbankSearchService,
    AssistantService,
    {
      provide: MEDICINE_REMINDER_READER,
      useExisting: MedicineRemindersService,
    },
    {
      provide: DAILY_RECORD_READER,
      useExisting: DailyRecordsService,
    },
    {
      provide: DAILY_RECORD_CANDIDATE_GENERATOR,
      useExisting: DailyRecordCandidatesService,
    },
  ],
  exports: [HistoricalAiSummaryService],
})
export class AssistantModule {}
