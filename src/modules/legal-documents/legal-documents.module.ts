import { Module } from '@nestjs/common';
import { LegalDocumentsController } from './legal-documents.controller.js';
import { LegalDocumentsService } from './services/documents.service.js';

@Module({
  controllers: [LegalDocumentsController],
  providers: [LegalDocumentsService],
})
export class LegalDocumentsModule {}
