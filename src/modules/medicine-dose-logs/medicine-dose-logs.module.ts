import { Module } from '@nestjs/common';
import { HealthEventsModule } from '../health-events/health-events.module';
import { MedicineDoseLogsController } from './medicine-dose-logs.controller';
import { MedicineDoseLogsService } from './services/dose-logs.service';
import {
  MedicineDoseLogReaderPort,
  MedicineDoseLogRepositoryPort,
  MedicineDoseLogRepository,
} from './repositories/dose-log.repository';
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
