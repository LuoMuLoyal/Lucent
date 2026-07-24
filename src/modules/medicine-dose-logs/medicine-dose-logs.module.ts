import { Module } from '@nestjs/common';
import { MedicineDoseLogsController } from './medicine-dose-logs.controller';
import { MedicineDoseLogsService } from './services/dose-logs.service';
import {
  MedicineDoseLogReaderPort,
  MedicineDoseLogRepositoryPort,
  MedicineDoseLogRepository,
} from './repositories/dose-log.repository';
@Module({
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
