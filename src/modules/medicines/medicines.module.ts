import { Module } from '@nestjs/common';
import { LlmCommonModule } from '../../common';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { MedicinesCacheAdminService } from './cache/admin.service';

import { MedicinesCacheService } from './cache/store.service';
import { MedicinesController } from './medicines.controller';
import { MedicinesService } from './services/medicines.service';

import { MedicineRecognitionQueueService } from './services/recognition-queue.service';
import { MedicineRiskCheckService } from './services/risk-check.service';
import { MedicineRiskCheckListener } from './services/risk-check.listener';
import { MedicineRiskLlmGeneratorService } from './services/risk-llm-generator.service';
import { RiskDetectionService } from './services/risk-detection.service';
import { RiskContextBuilderService } from './services/risk-context-builder.service';
import { CnMedicinesService } from './adapters/cn.service';

import { DrugbankMedicinesService } from './adapters/drugbank.service';

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
  exports: [DrugbankMedicinesService, CnMedicinesService],
})
export class MedicinesModule {}
