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
import { AssistantRuntimeService } from './adapters/agent/runtime.js';
import { AssistantStreamService } from './application/services/stream.js';
import { AssistantCheckpointerService } from './infrastructure/agent/checkpointer.js';
import { Conversations } from './application/use_cases/conversation.js';
import { AssistantMemoryService } from './application/services/memory.js';
import { AssistantController } from './adapters/http/assistant.controller.js';
import { AssistantPolicyService } from './application/services/policy.js';
import { HistoricalAiSummaryService } from './application/use_cases/summaries.js';
import { AssistantService } from './application/use_cases/assistant.js';
import { AssistantProposalConfirmService } from './application/use_cases/confirm-proposal.js';
import { AssistantStreamOrchestratorService } from './application/use_cases/stream-message.js';
import {
  DAILY_RECORD_CANDIDATE_GENERATOR,
  DAILY_RECORD_READER,
  MEDICINE_REMINDER_READER,
} from './application/ports/readers.js';
import { ASSISTANT_CONVERSATIONS } from './domain/conversation/conversations.js';
import { ASSISTANT_MEMORIES } from './domain/memory/memories.js';

import { ASSISTANT_SUMMARIES } from './domain/summary/summaries.js';
import {
  ASSISTANT_AGENT_RUNTIME,
  ASSISTANT_CHECKPOINTER,
  ASSISTANT_TOOL_EXECUTOR,
} from './application/ports/agent-runtime.js';
import { PrismaConversations } from './infrastructure/persistence/conversations.js';
import { PrismaMemories } from './infrastructure/persistence/memories.js';
import { PrismaSummaries } from './infrastructure/persistence/summaries.js';
import { AssistantContextService } from './application/services/tool-context.js';

import { AssistantToolDrugbankEntityResolveService } from './adapters/acl/tools/drugbank/entity-resolve.service.js';

import { AssistantToolDrugbankSearchService } from './adapters/acl/tools/drugbank/search.service.js';

import { LightragClientService } from './infrastructure/retrieval/lightrag-client.js';

import { AssistantToolKnowledgeRetrievalService } from './adapters/acl/tools/retrieval/knowledge.service.js';

import { SemanticaClientService } from './infrastructure/retrieval/semantica-client.js';

import { OntologyCypherGeneratorService } from './adapters/acl/tools/ontology/cypher-generator.service.js';
import { AssistantIntentClassifierService } from './application/services/intent-classifier.js';

import { AssistantToolOntologyReasoningService } from './adapters/acl/tools/ontology/ontology-reasoning.service.js';

import { AssistantToolRuleReasoningService } from './adapters/acl/tools/ontology/rule-reasoning.service.js';

import { AssistantToolMedicineLookupService } from './adapters/acl/tools/medicine/lookup.service.js';
import { AssistantDrugbankLookupService } from './adapters/acl/tools/medicine/drugbank-lookup.service.js';

import { AssistantToolProposalService } from './adapters/acl/tools/proposal/proposal.service.js';
import { AssistantDailyRecordProposalService } from './adapters/acl/tools/proposal/daily-record-proposal.service.js';
import { AssistantSettingsProposalService } from './adapters/acl/tools/proposal/settings-proposal.service.js';

import { AssistantToolReadService } from './adapters/acl/tools/read/read.service.js';

import { AssistantToolRecordQueryService } from './adapters/acl/tools/records/query.service.js';

import { AssistantToolService } from './adapters/acl/tool-executor.js';

import { VectorStoreFactory } from './adapters/acl/tools/vector/vector-store.factory.js';

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
    { provide: ASSISTANT_AGENT_RUNTIME, useExisting: AssistantRuntimeService },
    AssistantStreamService,
    AssistantCheckpointerService,
    VectorStoreFactory,
    PrismaConversations,
    { provide: ASSISTANT_CONVERSATIONS, useExisting: PrismaConversations },
    PrismaMemories,
    { provide: ASSISTANT_MEMORIES, useExisting: PrismaMemories },
    PrismaSummaries,
    { provide: ASSISTANT_SUMMARIES, useExisting: PrismaSummaries },
    Conversations,
    AssistantMemoryService,
    AssistantPolicyService,
    HistoricalAiSummaryService,
    AssistantContextService,
    AssistantToolRecordQueryService,
    AssistantToolProposalService,
    AssistantDailyRecordProposalService,
    AssistantSettingsProposalService,
    AssistantToolService,
    { provide: ASSISTANT_TOOL_EXECUTOR, useExisting: AssistantToolService },
    { provide: ASSISTANT_CHECKPOINTER, useExisting: AssistantCheckpointerService },
    AssistantToolReadService,
    LightragClientService,
    AssistantToolKnowledgeRetrievalService,
    SemanticaClientService,
    OntologyCypherGeneratorService,
    AssistantIntentClassifierService,
    AssistantToolOntologyReasoningService,
    AssistantToolRuleReasoningService,
    AssistantToolMedicineLookupService,
    AssistantDrugbankLookupService,
    AssistantToolDrugbankEntityResolveService,
    AssistantToolDrugbankSearchService,
    AssistantProposalConfirmService,
    AssistantStreamOrchestratorService,
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
