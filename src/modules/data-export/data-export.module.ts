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
import { DataExportController } from './adapters/http/data-export.controller.js';
import { ProcessExport } from './application/use_cases/process-export.js';
import { CreateDataExportRequest } from './application/use_cases/create-data-export-request.js';
import { PrismaObjectStorage } from './infrastructure/storage/object-storage.js';
import { BullmqExportQueue } from './adapters/queue/export-queue.js';
import { ObjectStorage } from './application/ports/object-storage.js';
import { ExportQueue } from './application/ports/export-queue.js';
import { DataExportRequests } from './application/ports/data-export-requests.js';
import { PrismaDataExportRequests } from './infrastructure/persistence/data-export-requests.js';
import { ReportExportPdfService } from './infrastructure/pdf/report-pdf.js';

@Module({
  imports: [AuthModule, ReportsModule, NotificationsModule, StorageModule],
  controllers: [DataExportController],
  providers: [
    PrismaObjectStorage,
    { provide: ObjectStorage, useExisting: PrismaObjectStorage },
    { provide: DataExportRequests, useClass: PrismaDataExportRequests },
    PrismaDataExportRequests,
    ReportExportPdfService,
    ProcessExport,
    BullmqExportQueue,
    { provide: ExportQueue, useExisting: BullmqExportQueue },
    CreateDataExportRequest,
  ],
})
export class DataExportModule {}
