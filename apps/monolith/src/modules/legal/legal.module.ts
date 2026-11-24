import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller.js';
import { LegalAdminService } from './services/admin.service.js';
import { LegalService } from './services/documents.service.js';

@Module({
  controllers: [LegalController],
  providers: [LegalService, LegalAdminService],
  exports: [LegalAdminService],
})
export class LegalModule {}
