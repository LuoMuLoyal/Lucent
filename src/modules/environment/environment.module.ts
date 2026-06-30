import { Module } from '@nestjs/common';
import { EnvironmentController } from './environment.controller';
import { EnvironmentService } from './services/environment.service';

@Module({
  controllers: [EnvironmentController],
  providers: [EnvironmentService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class EnvironmentModule {}
