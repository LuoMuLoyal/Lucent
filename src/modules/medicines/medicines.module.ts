import { Module } from '@nestjs/common';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { MedicinesCacheAdminService, MedicinesCacheService } from './cache';
import { MedicinesController } from './medicines.controller';
import { MedicinesService, MedicineRecognitionQueueService } from './services';
import { CnMedicinesService, DrugbankMedicinesService } from './adapters';

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
