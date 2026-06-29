import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';
import { DataExportCosRuntime } from './config/data-export-cos.runtime';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';
import { DataExportStorageService } from './services/data-export-storage.service';
import { DataExportQueueService } from './services/data-export-queue.service';
import { ReportExportPdfService } from './services/report-export-pdf.service';
import { ReportChartService } from './services/report-chart.service';

@Module({
  imports: [AuthModule, ReportsModule, NotificationsModule],
  controllers: [DataExportController],
  providers: [
    DataExportCosRuntime,
    DataExportStorageService,
    ReportExportPdfService,
    ReportChartService,
    DataExportQueueService,
    DataExportService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class DataExportModule {}
