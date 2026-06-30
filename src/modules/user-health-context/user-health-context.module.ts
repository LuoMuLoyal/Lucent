import { Module } from '@nestjs/common';
import { UserHealthContextController } from './user-health-context.controller';
import { UserHealthContextOwnershipService } from './services/ownership.service';
import { UserHealthContextMapperService } from './services/user-health-context-mapper.service';
import { UserHealthContextProfileWriteService } from './services/user-health-context-profile-write.service';
import { UserHealthContextAllergyWriteService } from './services/user-health-context-allergy-write.service';
import { UserHealthContextConditionWriteService } from './services/user-health-context-condition-write.service';
import { UserHealthContextMedicineWriteService } from './services/user-health-context-medicine-write.service';
import { UserHealthContextService } from './services/user-health-context.service';

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
