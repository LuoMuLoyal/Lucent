import { Module } from '@nestjs/common';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { MedicinesCacheAdminService } from './cache/medicines-cache-admin.service';
import { MedicinesCacheService } from './cache/medicines-cache.service';
import { MedicinesController } from './medicines.controller';
import { MedicinesService } from './services/medicines.service';
import { CnMedicinesService } from './sources/cn-medicines.service';
import { DrugbankMedicinesService } from './sources/drugbank-medicines.service';

@Module({
  imports: [LlmRuntimeModule],
  controllers: [MedicinesController],
  providers: [
    MedicinesService,
    MedicinesCacheAdminService,
    MedicinesCacheService,
    DrugbankMedicinesService,
    CnMedicinesService,
  ],
  exports: [DrugbankMedicinesService, CnMedicinesService],
})
export class MedicinesModule {}
