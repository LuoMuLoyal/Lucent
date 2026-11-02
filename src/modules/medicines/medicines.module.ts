import { Module } from '@nestjs/common';
import { LlmCommonModule } from '../../common/index.js';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module.js';
import { MedicinesCacheAdminService } from './application/use_cases/rebuild-index.js';

import { MedicinesCacheService } from './infrastructure/cache/store.js';
import { MedicinesCacheMaintenanceService } from './infrastructure/cache/maintenance.js';
import { MedicinesController } from './adapters/http/medicines.controller.js';
import { MedicinesRelationsController } from './adapters/http/medicines-relations.controller.js';
import { MedicationOverviewController } from './adapters/http/medication-overview.controller.js';
import { MedicationOverviewService } from './application/use_cases/medication-overview.js';
import { MedicinesService } from './application/use_cases/medicines.js';
import { MedicineSearchReadModel } from './application/read_models/medicine-card.js';
import { MedicineDetailReadModel } from './application/read_models/medicine-detail.js';
import { MedicineSequenceReadModel } from './application/read_models/medicine-sequence.js';
import { SafetyTipsAdminService } from './application/use_cases/safety-tips-admin.js';

import { MedicineRecognitionQueueService } from './adapters/queue/recognition.js';
import { MedicineRiskCheckService } from './application/use_cases/check-risk.js';
import { MedicineRiskRefreshQueueService } from './adapters/queue/risk-refresh.js';
import { MedicineRiskLlmGeneratorService } from './infrastructure/llm/risk-check.js';
import { RiskDetectionService } from './domain/services/risk-scoring.js';
import { CnMedicinesService } from './infrastructure/persistence/cn.js';

import { DrugbankMedicinesService } from './infrastructure/persistence/drugbank.js';
import { MedicineSafetyTipsRepository } from './infrastructure/persistence/safety-tips.js';
import { MedicineSafetyTipsStore } from './infrastructure/persistence/safety-tips.js';
import { MedicineRiskRecordsStore } from './infrastructure/persistence/risk-records.js';
import { PrismaRiskAssessmentStore } from './infrastructure/persistence/risk-assessments.js';
import {
  MEDICINES_KNOWLEDGE_CACHE,
  CN_MEDICINES_READER,
  DRUGBANK_MEDICINES_READER,
} from './application/ports/knowledge.js';
import {
  MEDICINE_SAFETY_TIPS_SOURCE,
  MEDICINE_SAFETY_TIP_REPOSITORY,
} from './application/ports/safety-tips.js';
import { MEDICINE_RISK_RECORDS } from './application/ports/risk-records.js';
import { RISK_ASSESSMENT_STORE } from './application/ports/risk-assessment.js';
import { MEDICINE_RISK_LLM_GENERATOR } from './application/ports/risk-llm.js';
import { MEDICINES_CACHE_MAINTENANCE } from './application/ports/cache-maintenance.js';
import { MEDICINES_GRAPH_READER } from './domain/relations/relations.js';
import { MedicineGraphExecutor } from './infrastructure/graph/executor.js';
import { Neo4jGraphReader } from './infrastructure/graph/reader.js';

@Module({
  imports: [LlmRuntimeModule, LlmCommonModule],
  controllers: [
    MedicinesController,
    MedicinesRelationsController,
    MedicationOverviewController,
  ],
  providers: [
    MedicinesService,
    MedicineSearchReadModel,
    MedicineDetailReadModel,
    MedicineSequenceReadModel,
    SafetyTipsAdminService,
    MedicineRecognitionQueueService,
    MedicineRiskCheckService,
    MedicineRiskRefreshQueueService,
    MedicineRiskLlmGeneratorService,
    RiskDetectionService,
    MedicinesCacheAdminService,
    MedicinesCacheService,
    DrugbankMedicinesService,
    CnMedicinesService,
    MedicinesCacheMaintenanceService,
    MedicineSafetyTipsStore,
    MedicineSafetyTipsRepository,
    MedicineRiskRecordsStore,
    PrismaRiskAssessmentStore,
    MedicationOverviewService,
    MedicineGraphExecutor,
    Neo4jGraphReader,
    { provide: MEDICINES_GRAPH_READER, useExisting: Neo4jGraphReader },
    { provide: MEDICINES_KNOWLEDGE_CACHE, useExisting: MedicinesCacheService },
    { provide: CN_MEDICINES_READER, useExisting: CnMedicinesService },
    {
      provide: DRUGBANK_MEDICINES_READER,
      useExisting: DrugbankMedicinesService,
    },
    {
      provide: MEDICINES_CACHE_MAINTENANCE,
      useExisting: MedicinesCacheMaintenanceService,
    },
    {
      provide: MEDICINE_SAFETY_TIPS_SOURCE,
      useExisting: MedicineSafetyTipsStore,
    },
    {
      provide: MEDICINE_SAFETY_TIP_REPOSITORY,
      useExisting: MedicineSafetyTipsRepository,
    },
    { provide: MEDICINE_RISK_RECORDS, useExisting: MedicineRiskRecordsStore },
    {
      provide: RISK_ASSESSMENT_STORE,
      useExisting: PrismaRiskAssessmentStore,
    },
    {
      provide: MEDICINE_RISK_LLM_GENERATOR,
      useExisting: MedicineRiskLlmGeneratorService,
    },
  ],
  exports: [
    DrugbankMedicinesService,
    CnMedicinesService,
    MedicineRiskCheckService,
    SafetyTipsAdminService,
  ],
})
export class MedicinesModule {}
