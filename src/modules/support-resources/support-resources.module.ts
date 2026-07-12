import { Module } from '@nestjs/common';
import { SupportResourcesController } from './support-resources.controller';
import { SupportResourcesService } from './services/resources.service';

@Module({
  controllers: [SupportResourcesController],
  providers: [SupportResourcesService],
})
export class SupportResourcesModule {}
