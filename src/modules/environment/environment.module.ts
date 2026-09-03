import { Module } from '@nestjs/common';
import { EnvironmentController } from './environment.controller.js';
import { EnvironmentService } from './services/snapshot.service.js';

@Module({
  controllers: [EnvironmentController],
  providers: [EnvironmentService],
})
export class EnvironmentModule {}
