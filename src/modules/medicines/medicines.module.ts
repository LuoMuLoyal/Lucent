import { Module } from '@nestjs/common';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { MedicinesCacheAdminService } from './cache/cache-admin.service';
import { MedicinesCacheService } from './cache/cache.service';
import { MedicinesController } from './medicines.controller';
import { MedicinesService } from './services/medicines.service';
import { MedicineRecognitionQueueService } from './services/medicine-recognition-queue.service';
import { CnMedicinesService } from './adapters/cn.service';
import { DrugbankMedicinesService } from './adapters/drugbank.service';

@Module({
  imports: [LlmRuntimeModule],
  controllers: [MedicinesController],
  providers: [
    MedicinesService,
    MedicineRecognitionQueueService,
    MedicinesCacheAdminService,
    MedicinesCacheService,
    DrugbankMedicinesService,
    CnMedicinesService,
  ],
  exports: [DrugbankMedicinesService, CnMedicinesService],
})
export class MedicinesModule {}
