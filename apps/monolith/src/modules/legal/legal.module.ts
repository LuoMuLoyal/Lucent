import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller.js';
import { LegalDocumentsAdminService } from './services/admin.service.js';
import { LegalDocumentsService } from './services/documents.service.js';

@Module({
  controllers: [LegalController],
  providers: [LegalDocumentsService, LegalDocumentsAdminService],
  exports: [LegalDocumentsAdminService],
})
export class LegalModule {}
