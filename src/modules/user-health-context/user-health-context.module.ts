import { Module } from '@nestjs/common';
import { UserHealthContextController } from './user-health-context.controller';
import { UserHealthContextOwnershipService } from './guards/ownership.service';
import { UserHealthContextMapperService } from './services/user-health-context-mapper.service';
import { UserHealthContextProfileWriteService } from './services/user-health-context-profile-write.service';
import { UserHealthContextService } from './user-health-context.service';

@Module({
  controllers: [UserHealthContextController],
  providers: [
    UserHealthContextOwnershipService,
    UserHealthContextMapperService,
    UserHealthContextProfileWriteService,
    UserHealthContextService,
  ],
  exports: [UserHealthContextService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class UserHealthContextModule {}
