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

@Module({
  controllers: [UserHealthContextController],
  providers: [
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
