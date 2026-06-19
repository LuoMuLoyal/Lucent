import { Module } from '@nestjs/common';
import { UserHealthContextController } from './user-health-context.controller';
import { UserHealthContextGuardService } from './user-health-context-guard.service';
import { UserHealthContextMapperService } from './user-health-context-mapper.service';
import { UserHealthContextProfileWriteService } from './user-health-context-profile-write.service';
import { UserHealthContextService } from './user-health-context.service';

@Module({
  controllers: [UserHealthContextController],
  providers: [
    UserHealthContextGuardService,
    UserHealthContextMapperService,
    UserHealthContextProfileWriteService,
    UserHealthContextService,
  ],
  exports: [UserHealthContextService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class UserHealthContextModule {}
