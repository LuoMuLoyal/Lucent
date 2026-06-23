import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { DataExportCosRuntime } from './config/data-export-cos.runtime';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';
import { DataExportStorageService } from './services/data-export-storage.service';
import { ReportExportPdfService } from './services/report-export-pdf.service';

@Module({
  imports: [AuthModule, ReportsModule],
  controllers: [DataExportController],
  providers: [
    DataExportCosRuntime,
    DataExportStorageService,
    ReportExportPdfService,
    DataExportService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class DataExportModule {}
