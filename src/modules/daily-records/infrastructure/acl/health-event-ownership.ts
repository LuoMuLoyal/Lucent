import { Injectable } from '@nestjs/common';

import { HealthEventsOwnershipService } from '../../../health-events/index.js';
import { HealthEventOwnership } from '../../application/ports/health-events.js';

/**
 * Adapts the Health Log context's ownership service to this context's port.
 *
 * The port and the upstream service differ only in method name
 * (`ensureActive` vs `ensureActiveOwnedByUser`). Translating here rather than
 * widening the port keeps this context's vocabulary its own: if Health Log
 * renames its method again, only this file changes.
 */
@Injectable()
export class HealthEventOwnershipAdapter extends HealthEventOwnership {
  constructor(private readonly upstream: HealthEventsOwnershipService) {
    super();
  }

  async ensureActive(userId: string, eventId: string): Promise<void> {
    await this.upstream.ensureActiveOwnedByUser(userId, eventId);
  }
}
