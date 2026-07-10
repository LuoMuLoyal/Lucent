import { Module } from '@nestjs/common';
import { MedicineDoseLogsController } from './medicine-dose-logs.controller';
import { MedicineDoseLogsService } from './services/medicine-dose-logs.service';
import {
  MedicineDoseLogRepositoryPort,
  MedicineDoseLogRepository,
} from './repositories';

@Module({
  controllers: [MedicineDoseLogsController],
  providers: [
    MedicineDoseLogRepository,
    {
      provide: MedicineDoseLogRepositoryPort,
      useExisting: MedicineDoseLogRepository,
    },
    MedicineDoseLogsService,
  ],
})
export class MedicineDoseLogsModule {}
