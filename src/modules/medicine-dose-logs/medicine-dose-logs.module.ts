import { Module } from '@nestjs/common';

import { HealthEventsModule } from '../health-events/health-events.module.js';
import { MedicineDoseLogsController } from './adapters/http/medicine-dose-logs.controller.js';
import { HealthEventsGuardAdapter } from './adapters/acl/health-events-guard.js';
import { PublishedDoseLogEvents } from './adapters/events/dose-log-changed.js';
import { MedicineDoseLogsService } from './application/services/medicine-dose-logs.js';
import { DoseLogEvents } from './application/ports/dose-log-events.js';
import { HealthEventGuard } from './application/ports/health-event-guard.js';
import { DoseLogsForDate } from './application/read_models/dose-logs-for-date.js';
import { CreateDoseLog } from './application/use_cases/create-dose-log.js';
import { DeleteDoseLog } from './application/use_cases/delete-dose-log.js';
import { DoseTargetResolver } from './application/use_cases/dose-target-resolver.js';
import { MarkDoseLog } from './application/use_cases/mark-dose-log.js';
import { UpdateDoseLog } from './application/use_cases/update-dose-log.js';
import { MedicineDoseLogReaderPort } from './domain/dose-log/dose-log-facts.js';
import { DoseLogs } from './domain/dose-log/dose-logs.js';
import { PrismaDoseLogs } from './infrastructure/persistence/dose-logs.js';

/**
 * Medication Tracking context — dose logs (ADR-0024).
 *
 * `PrismaDoseLogs` implements both `DoseLogs` (write side) and `DoseLogFacts`
 * (cross-context reads); the module exposes only the reader port, since no other
 * context may write dose logs.
 */
@Module({
  imports: [HealthEventsModule],
  controllers: [MedicineDoseLogsController],
  providers: [
    PrismaDoseLogs,
    { provide: DoseLogs, useExisting: PrismaDoseLogs },
    { provide: MedicineDoseLogReaderPort, useExisting: PrismaDoseLogs },
    PublishedDoseLogEvents,
    { provide: DoseLogEvents, useExisting: PublishedDoseLogEvents },
    HealthEventsGuardAdapter,
    { provide: HealthEventGuard, useExisting: HealthEventsGuardAdapter },
    DoseTargetResolver,
    CreateDoseLog,
    MarkDoseLog,
    UpdateDoseLog,
    DeleteDoseLog,
    DoseLogsForDate,
    MedicineDoseLogsService,
  ],
  exports: [MedicineDoseLogReaderPort],
})
export class MedicineDoseLogsModule {}
