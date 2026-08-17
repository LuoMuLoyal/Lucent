import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DailyRecordCandidatesService } from '../daily-records';
import { DailyRecordsService } from '../daily-records';
import { DailyRecordsModule } from '../daily-records/daily-records.module';
import { LlmCommonModule } from '../../common';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { MedicineRemindersModule } from '../medicine-reminders/medicine-reminders.module';
import { MedicineRemindersService } from '../medicine-reminders';
import { MedicinesModule } from '../medicines/medicines.module';
import { UserHealthContextModule } from '../user-health-context/user-health-context.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { AssistantRuntimeService } from './agent/runtime.service';
import { AssistantCheckpointerService } from './agent/checkpointer.service';
import { AssistantConversationService } from './services/conversation.service';
import { AssistantMemoryService } from './services/memory.service';
import { AssistantController } from './assistant.controller';
import { AssistantPolicyService } from './services/policy.service';
import { HistoricalAiSummaryService } from './services/historical-ai-summary.service';
import { AssistantService } from './services/core.service';
import {
  DAILY_RECORD_CANDIDATE_GENERATOR,
  DAILY_RECORD_READER,
  MEDICINE_REMINDER_READER,
} from './types/ports';
import {
  AssistantConversationRepository,
  AssistantConversationRepositoryPort,
} from './repositories/conversation.repository';
import {
  AssistantMemoryRepository,
  AssistantMemoryRepositoryPort,
} from './repositories/memory.repository';

import {
  AssistantSummaryRepository,
  AssistantSummaryRepositoryPort,
} from './repositories/summary.repository';
import { AssistantContextService } from './tools/shared/context.service';

import { AssistantToolDrugbankEntityResolveService } from './tools/drugbank/entity-resolve.service';

import { AssistantToolDrugbankSearchService } from './tools/drugbank/search.service';

import { AssistantToolLeafletReadService } from './tools/leaflet/read.service';

import { AssistantToolMedicalKnowledgeService } from './tools/knowledge/medical.service';

import { AssistantToolMedicineLookupService } from './tools/medicine/lookup.service';

import { AssistantToolProposalService } from './tools/proposal/proposal.service';

import { AssistantToolReadService } from './tools/read/read.service';

import { AssistantToolRecordQueryService } from './tools/records/query.service';

import { AssistantToolService } from './tools/tool.service';

import { VectorStoreFactory } from './tools/vector/vector-store.factory';

@Module({
  imports: [
    AuthModule,
    LlmCommonModule,
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
    AssistantCheckpointerService,
    VectorStoreFactory,
    {
      provide: AssistantConversationRepositoryPort,
      useClass: AssistantConversationRepository,
    },
    {
      provide: AssistantMemoryRepositoryPort,
      useClass: AssistantMemoryRepository,
    },
    {
      provide: AssistantSummaryRepositoryPort,
      useClass: AssistantSummaryRepository,
    },
    AssistantConversationService,
    AssistantMemoryService,
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
