import { Module } from '@nestjs/common';
import { LegalDocumentsController } from './legal-documents.controller';
import { LegalDocumentsService } from './services';

@Module({
  controllers: [LegalDocumentsController],
  providers: [LegalDocumentsService],
})
export class LegalDocumentsModule {}
