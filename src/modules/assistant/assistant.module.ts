import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DailyRecordCandidatesService } from '../daily-records/index.js';
import { DailyRecordsService } from '../daily-records/index.js';
import { DailyRecordsModule } from '../daily-records/daily-records.module.js';
import { LlmCommonModule } from '../../common/index.js';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module.js';
import { MedicineRemindersModule } from '../medicine-reminders/medicine-reminders.module.js';
import { MedicineRemindersService } from '../medicine-reminders/index.js';
import { MedicinesModule } from '../medicines/medicines.module.js';
import { UserHealthContextModule } from '../user-health-context/user-health-context.module.js';
import { UserSettingsModule } from '../user-settings/user-settings.module.js';
import { AssistantRuntimeService } from './agent/runtime.service.js';
import { AssistantCheckpointerService } from './agent/checkpointer.service.js';
import { AssistantConversationService } from './services/conversation.service.js';
import { AssistantMemoryService } from './services/memory.service.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantPolicyService } from './services/policy.service.js';
import { HistoricalAiSummaryService } from './services/historical-ai-summary.service.js';
import { AssistantService } from './services/core.service.js';
import {
  DAILY_RECORD_CANDIDATE_GENERATOR,
  DAILY_RECORD_READER,
  MEDICINE_REMINDER_READER,
} from './types/ports.js';
import {
  AssistantConversationRepository,
  AssistantConversationRepositoryPort,
} from './repositories/conversation.repository.js';
import {
  AssistantMemoryRepository,
  AssistantMemoryRepositoryPort,
} from './repositories/memory.repository.js';

import {
  AssistantSummaryRepository,
  AssistantSummaryRepositoryPort,
} from './repositories/summary.repository.js';
import { AssistantContextService } from './tools/shared/context.service.js';

import { AssistantToolDrugbankEntityResolveService } from './tools/drugbank/entity-resolve.service.js';

import { AssistantToolDrugbankSearchService } from './tools/drugbank/search.service.js';

import { AssistantToolLeafletReadService } from './tools/leaflet/read.service.js';

import { AssistantToolMedicalKnowledgeService } from './tools/knowledge/medical.service.js';

import { AssistantToolMedicineLookupService } from './tools/medicine/lookup.service.js';

import { AssistantToolProposalService } from './tools/proposal/proposal.service.js';

import { AssistantToolReadService } from './tools/read/read.service.js';

import { AssistantToolRecordQueryService } from './tools/records/query.service.js';

import { AssistantToolService } from './tools/tool.service.js';

import { VectorStoreFactory } from './tools/vector/vector-store.factory.js';

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
