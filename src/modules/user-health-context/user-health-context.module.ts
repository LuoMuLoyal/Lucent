import { Module } from '@nestjs/common';
import { UserHealthContextController } from './user-health-context.controller';
import { UserHealthContextService } from './user-health-context.service';

@Module({
  controllers: [UserHealthContextController],
  providers: [UserHealthContextService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class UserHealthContextModule {}
