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

import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { StorageModule } from '../../common/index.js';
import { DataExportController } from './data-export.controller.js';
import { DataExportProcessorService } from './services/processor.service.js';
import { DataExportService } from './services/export.service.js';
import { DataExportStorageService } from './services/storage.service.js';
import { DataExportQueueService } from './services/queue.service.js';
import { ReportExportPdfService } from './services/report-pdf/pdf.service.js';

@Module({
  imports: [AuthModule, ReportsModule, NotificationsModule, StorageModule],
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
