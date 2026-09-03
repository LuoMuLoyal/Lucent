import { Module } from '@nestjs/common';
import { HealthEventsModule } from '../health-events/health-events.module.js';
import { MedicineDoseLogsController } from './medicine-dose-logs.controller.js';
import { MedicineDoseLogsService } from './services/dose-logs.service.js';
import {
  MedicineDoseLogReaderPort,
  MedicineDoseLogRepositoryPort,
  MedicineDoseLogRepository,
} from './repositories/dose-log.repository.js';
@Module({
  imports: [HealthEventsModule],
  controllers: [MedicineDoseLogsController],
  providers: [
    MedicineDoseLogRepository,
    {
      provide: MedicineDoseLogRepositoryPort,
      useExisting: MedicineDoseLogRepository,
    },
    {
      provide: MedicineDoseLogReaderPort,
      useExisting: MedicineDoseLogRepository,
    },
    MedicineDoseLogsService,
  ],
  exports: [MedicineDoseLogReaderPort],
})
export class MedicineDoseLogsModule {}
