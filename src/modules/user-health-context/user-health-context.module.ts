import { Module } from '@nestjs/common';
import { UserHealthContextController } from './user-health-context.controller';
import { UserHealthContextAllergyWriteService } from './services/writes/allergy-write.service';

import { UserHealthContextConditionWriteService } from './services/writes/condition-write.service';

import { UserHealthContextMapperService } from './services/mapper.service';

import { UserHealthContextMedicineWriteService } from './services/writes/medicine-write.service';

import { UserHealthContextOwnershipService } from './services/ownership.service';

import { UserHealthContextProfileWriteService } from './services/writes/profile-write.service';

import { UserHealthContextService } from './services/health-context.service';
import {
  UserHealthContextRepositoryPort,
  UserHealthContextRepository,
} from './repositories/health-context.repository';

@Module({
  controllers: [UserHealthContextController],
  providers: [
    UserHealthContextRepository,
    {
      provide: UserHealthContextRepositoryPort,
      useExisting: UserHealthContextRepository,
    },
    UserHealthContextOwnershipService,
    UserHealthContextMapperService,
    UserHealthContextProfileWriteService,
    UserHealthContextAllergyWriteService,
    UserHealthContextConditionWriteService,
    UserHealthContextMedicineWriteService,
    UserHealthContextService,
  ],
  exports: [UserHealthContextService],
})
export class UserHealthContextModule {}
