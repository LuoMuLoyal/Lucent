import { Module } from '@nestjs/common';
import { LlmCommonModule } from '../../common/index.js';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module.js';
import { MedicinesCacheAdminService } from './cache/admin.service.js';

import { MedicinesCacheService } from './cache/store.service.js';
import { MedicinesController } from './medicines.controller.js';
import { MedicinesService } from './services/medicines.service.js';

import { MedicineRecognitionQueueService } from './services/recognition-queue.service.js';
import { MedicineRiskCheckService } from './services/risk/risk-check.service.js';
import { MedicineRiskCheckListener } from './services/risk/risk-check.listener.js';
import { MedicineRiskLlmGeneratorService } from './services/risk/risk-llm-generator.service.js';
import { RiskDetectionService } from './services/risk/risk-detection.service.js';
import { RiskContextBuilderService } from './services/risk/risk-context-builder.service.js';
import { CnMedicinesService } from './adapters/cn.service.js';

import { DrugbankMedicinesService } from './adapters/drugbank.service.js';

@Module({
  imports: [LlmRuntimeModule, LlmCommonModule],
  controllers: [MedicinesController],
  providers: [
    MedicinesService,
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
  ],
})
export class MedicinesModule {}
