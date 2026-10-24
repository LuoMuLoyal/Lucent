import { Module } from '@nestjs/common';
import { LlmCommonModule } from '../../common/index.js';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module.js';
import { MedicinesCacheAdminService } from './application/use_cases/rebuild-index.js';

import { MedicinesCacheService } from './infrastructure/cache/store.js';
import { MedicinesCacheMaintenanceService } from './infrastructure/cache/maintenance.js';
import { MedicinesController } from './adapters/http/medicines.controller.js';
import { MedicinesService } from './application/use_cases/medicines.js';
import {
  SafetyTipsAdminService,
  QaChunksAdminService,
} from './application/use_cases/import-catalog.js';

import { MedicineRecognitionQueueService } from './adapters/queue/recognition.js';
import { MedicineRiskCheckService } from './application/use_cases/check-risk.js';
import { MedicineRiskCheckListener } from './adapters/events/risk-assessment-requested.js';
import { MedicineRiskLlmGeneratorService } from './infrastructure/llm/risk-check.js';
import { RiskDetectionService } from './domain/services/risk-scoring.js';
import { CnMedicinesService } from './infrastructure/persistence/cn.js';

import { DrugbankMedicinesService } from './infrastructure/persistence/drugbank.js';
import { MedicineSafetyTipsRepository } from './infrastructure/persistence/safety-tips.js';
import { MedicineSafetyTipsStore } from './infrastructure/persistence/safety-tips.js';
import { MedicalQaChunksRepository } from './infrastructure/persistence/qa-chunks.js';
import { MedicineRiskRecordsStore } from './infrastructure/persistence/risk-records.js';
import {
  MEDICINES_KNOWLEDGE_CACHE,
  CN_MEDICINES_READER,
  DRUGBANK_MEDICINES_READER,
} from './application/ports/knowledge.js';
import {
  MEDICINE_SAFETY_TIPS_SOURCE,
  MEDICINE_SAFETY_TIP_REPOSITORY,
} from './application/ports/safety-tips.js';
import { MEDICINE_QA_CHUNK_REPOSITORY } from './application/ports/qa-chunks.js';
import { MEDICINE_RISK_RECORDS } from './application/ports/risk-records.js';
import { MEDICINE_RISK_LLM_GENERATOR } from './application/ports/risk-llm.js';
import { MEDICINES_CACHE_MAINTENANCE } from './application/ports/cache-maintenance.js';

@Module({
  imports: [LlmRuntimeModule, LlmCommonModule],
  controllers: [MedicinesController],
  providers: [
    MedicinesService,
    SafetyTipsAdminService,
    QaChunksAdminService,
    MedicineRecognitionQueueService,
    MedicineRiskCheckService,
    MedicineRiskCheckListener,
    MedicineRiskLlmGeneratorService,
    RiskDetectionService,
    MedicinesCacheAdminService,
    MedicinesCacheService,
    DrugbankMedicinesService,
    CnMedicinesService,
    MedicinesCacheMaintenanceService,
    MedicineSafetyTipsStore,
    MedicineSafetyTipsRepository,
    MedicalQaChunksRepository,
    MedicineRiskRecordsStore,
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
    {
      provide: MEDICINE_QA_CHUNK_REPOSITORY,
      useExisting: MedicalQaChunksRepository,
    },
    { provide: MEDICINE_RISK_RECORDS, useExisting: MedicineRiskRecordsStore },
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
    QaChunksAdminService,
  ],
})
export class MedicinesModule {}
