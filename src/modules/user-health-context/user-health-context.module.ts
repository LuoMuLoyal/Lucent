import { Module } from '@nestjs/common';
import { UserHealthContextController } from './user-health-context.controller.js';
import { UserHealthContextAllergyWriteService } from './services/writes/allergy-write.service.js';

import { UserHealthContextConditionWriteService } from './services/writes/condition-write.service.js';

import { UserHealthContextMapperService } from './services/mapper.service.js';

import { UserHealthContextMedicineWriteService } from './services/writes/medicine-write.service.js';

import { UserHealthContextOwnershipService } from './services/ownership.service.js';

import { UserHealthContextProfileWriteService } from './services/writes/profile-write.service.js';

import { UserHealthContextService } from './services/health-context.service.js';
import {
  UserHealthContextRepositoryPort,
  UserHealthContextRepository,
} from './repositories/health-context.repository.js';
import { IUserHealthContextReader } from './ports/health-context-reader.port.js';

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
    {
      provide: IUserHealthContextReader,
      useExisting: UserHealthContextService,
    },
  ],
  exports: [UserHealthContextService, IUserHealthContextReader],
})
export class UserHealthContextModule {}
