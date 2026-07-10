import { Module } from '@nestjs/common';
import { UserHealthContextController } from './user-health-context.controller';
import {
  UserHealthContextAllergyWriteService,
  UserHealthContextConditionWriteService,
  UserHealthContextMapperService,
  UserHealthContextMedicineWriteService,
  UserHealthContextOwnershipService,
  UserHealthContextProfileWriteService,
  UserHealthContextService,
} from './services';
import {
  UserHealthContextRepositoryPort,
  UserHealthContextRepository,
} from './repositories';

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
