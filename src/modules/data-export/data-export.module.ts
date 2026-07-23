/**
 * Report PDF generation and download module.
 *
 * Despite the historical name "data-export", this module does NOT export raw
 * user data (individual records, dose logs, etc.). It generates PDF reports
 * from aggregated dashboard data (via `ReportsService.getDashboard`) and
 * uploads them to object storage for download.
 *
 * Supported report kinds:
 * - `hospital` — campus hospital report (default)
 * - `monthly` — monthly summary report (forces 30-day range)
 * - `print` — print-friendly report
 *
 * If GDPR-style raw data export is needed in the future, it should be a
 * separate module that exports individual records, logs, and profile data —
 * not this report-generation pipeline.
 *
 * (Architecture review #14 — naming boundary documented.)
 */
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';
import { SecurityPinModule } from '../security-pin/security-pin.module';
import { StorageModule } from '../../common/storage';
import { DataExportController } from './data-export.controller';
import { DataExportProcessorService } from './services';
import { DataExportService } from './services';
import { DataExportStorageService } from './services';
import { DataExportQueueService } from './services';
import { ReportExportPdfService } from './services/report-pdf';

@Module({
  imports: [
    AuthModule,
    ReportsModule,
    NotificationsModule,
    SecurityPinModule,
    StorageModule,
  ],
  controllers: [DataExportController],
  providers: [
    DataExportStorageService,
    ReportExportPdfService,
    DataExportProcessorService,
    DataExportQueueService,
    DataExportService,
  ],
})
export class DataExportModule {}
