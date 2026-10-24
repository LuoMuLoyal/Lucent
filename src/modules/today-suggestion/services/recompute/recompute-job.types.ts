import type { MaterializationReasonCode } from '../../types/materialization.types.js';

/**
 * Payload of a resolved suggestion recompute job.
 *
 * Lives in its own module rather than in `queue.service.ts` so that the two
 * services on either side of the queue — `event-trigger.service.ts` (resolves
 * an event into this shape) and `worker.service.ts` (consumes it) — can depend
 * on the type without depending on the queue service, which imports both.
 */
export interface RecomputeJobData {
  userId: string;
  localDate: string;
  sourceVersion: number;
  reasonCodes: MaterializationReasonCode[];
}
