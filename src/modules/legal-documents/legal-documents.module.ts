import { Module } from '@nestjs/common';
import { LegalDocumentsController } from './legal-documents.controller.js';
import { LegalDocumentsAdminService } from './services/admin.service.js';
import { LegalDocumentsService } from './services/documents.service.js';

@Module({
  controllers: [LegalDocumentsController],
  providers: [LegalDocumentsService, LegalDocumentsAdminService],
  exports: [LegalDocumentsAdminService],
})
export class LegalDocumentsModule {}
