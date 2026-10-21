import { Module } from '@nestjs/common';
import { LlmCommonModule } from '../../common/index.js';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module.js';
import { MedicinesCacheAdminService } from './application/use_cases/rebuild_index.js';

import { MedicinesCacheService } from './infrastructure/cache/store.js';
import { MedicinesController } from './adapters/http/medicines.controller.js';
import { MedicinesService } from './application/use_cases/medicines.js';
import {
  SafetyTipsAdminService,
  QaChunksAdminService,
} from './application/use_cases/import_catalog.js';

import { MedicineRecognitionQueueService } from './adapters/queue/recognition.js';
import { MedicineRiskCheckService } from './application/use_cases/check_risk.js';
import { MedicineRiskCheckListener } from './adapters/events/risk_assessment_requested.js';
import { MedicineRiskLlmGeneratorService } from './infrastructure/llm/risk_check.js';
import { RiskDetectionService } from './domain/services/risk_scoring.js';
import { RiskContextBuilderService } from './adapters/acl/drug_source.js';
import { CnMedicinesService } from './infrastructure/persistence/cn.js';

import { DrugbankMedicinesService } from './infrastructure/persistence/drugbank.js';

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
    RiskContextBuilderService,
    MedicinesCacheAdminService,
    MedicinesCacheService,
    DrugbankMedicinesService,
    CnMedicinesService,
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
