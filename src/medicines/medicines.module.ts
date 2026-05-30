import { Module } from '@nestjs/common';
import { MedicinesController } from './medicines.controller';
import { MedicinesService } from './medicines.service';
import { CnMedicinesService } from './sources/cn-medicines.service';
import { DrugbankMedicinesService } from './sources/drugbank-medicines.service';

@Module({
  controllers: [MedicinesController],
  providers: [MedicinesService, DrugbankMedicinesService, CnMedicinesService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class MedicinesModule {}
