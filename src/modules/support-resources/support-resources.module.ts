import { Module } from '@nestjs/common';
import { SupportResourcesController } from './support-resources.controller';
import { SupportResourcesService } from './services/support-resources.service';

@Module({
  controllers: [SupportResourcesController],
  providers: [SupportResourcesService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class SupportResourcesModule {}
