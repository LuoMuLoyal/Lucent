import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';
import { SecurityPinModule } from '../security-pin/security-pin.module';
import { StorageModule } from '../../common/storage';
import { DataExportController } from './data-export.controller';
import { DataExportProcessorService } from './services/processor.service';
import { DataExportService } from './services/export.service';
import { DataExportStorageService } from './services/storage.service';
import { DataExportQueueService } from './services/queue.service';
import { ReportExportPdfService } from './services/report-pdf/pdf.service';

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
