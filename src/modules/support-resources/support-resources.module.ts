import { Module } from '@nestjs/common';
import { SupportResourcesController } from './support-resources.controller';
import { SupportResourcesService } from './services/support-resources.service';

@Module({
  controllers: [SupportResourcesController],
  providers: [SupportResourcesService],
})
export class SupportResourcesModule {}
