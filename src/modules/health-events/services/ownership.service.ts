import { Injectable } from '@nestjs/common';
import { EventsService } from './events.service';
import type { HealthEventRecord } from '../repositories/event.repository';

/** Cross-module ownership façade for health-event associations. */
@Injectable()
export class HealthEventsOwnershipService {
  constructor(private readonly eventsService: EventsService) {}

  ensureOwnedByUser(
    userId: string,
    eventId: string,
  ): Promise<HealthEventRecord> {
    return this.eventsService.ensureOwnedByUser(userId, eventId);
  }

  ensureActiveOwnedByUser(
    userId: string,
    eventId: string,
  ): Promise<HealthEventRecord> {
    return this.eventsService.ensureActiveOwnedByUser(userId, eventId);
  }
}
