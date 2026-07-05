import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';
import { SecurityPinModule } from '../security-pin/security-pin.module';
import { DataExportCosRuntime } from './config/data-export-cos.runtime';
import { DataExportController } from './data-export.controller';
import { DataExportProcessorService } from './services/data-export-processor.service';
import { DataExportService } from './services/data-export.service';
import { DataExportStorageService } from './services/data-export-storage.service';
import { DataExportQueueService } from './services/data-export-queue.service';
import { ReportExportPdfService } from './services/report-export-pdf.service';

@Module({
  imports: [AuthModule, ReportsModule, NotificationsModule, SecurityPinModule],
  controllers: [DataExportController],
  providers: [
    DataExportCosRuntime,
    DataExportStorageService,
    ReportExportPdfService,
    DataExportProcessorService,
    DataExportQueueService,
    DataExportService,
  ],
})
export class DataExportModule {}
