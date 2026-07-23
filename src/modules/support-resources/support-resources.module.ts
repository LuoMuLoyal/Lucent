import { Module } from '@nestjs/common';
import { SupportResourcesController } from './support-resources.controller';
import { SupportResourcesService } from './services';

@Module({
  controllers: [SupportResourcesController],
  providers: [SupportResourcesService],
})
export class SupportResourcesModule {}
