import { Module } from '@nestjs/common';
import { MedicineDoseLogsController } from './medicine-dose-logs.controller';
import { MedicineDoseLogsService } from './services/dose-logs.service';
import {
  MedicineDoseLogRepositoryPort,
  MedicineDoseLogRepository,
} from './repositories';
import { TodaySuggestionModule } from '../today-suggestion/today-suggestion.module';

@Module({
  imports: [TodaySuggestionModule],
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
