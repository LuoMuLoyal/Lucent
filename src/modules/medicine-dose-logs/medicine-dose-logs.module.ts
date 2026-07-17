import { Module, forwardRef } from '@nestjs/common';
import { MedicineDoseLogsController } from './medicine-dose-logs.controller';
import { MedicineDoseLogsService } from './services/dose-logs.service';
import {
  MedicineDoseLogReaderPort,
  MedicineDoseLogRepositoryPort,
  MedicineDoseLogRepository,
} from './repositories';
import { TodaySuggestionModule } from '../today-suggestion/today-suggestion.module';

@Module({
  // forwardRef: today-suggestion imports this module for
  // MedicineDoseLogReaderPort (ADR-0009); the reverse edge (suggestion cache
  // invalidation) is removed once architecture-review #2 moves invalidation
  // to domain events.
  imports: [forwardRef(() => TodaySuggestionModule)],
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
