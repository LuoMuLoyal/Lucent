/**
 * Read models for the dose-log resource.
 *
 * Both the list endpoint and the three write endpoints return the same rendered
 * shape (`DoseLogResource`), so the rendering lives in one function here rather
 * than in the service. Writes call it on the row they just wrote; the list calls
 * it per item (ADR-0024 section 4: read models own no invariants).
 */

import { formatDateOnly } from '../../../../common/helpers/format/date-time.utils.js';
import type { DoseLogRecord } from '../../domain/dose-log/dose-logs.js';
import type {
  DoseLogListResource,
  DoseLogResource,
} from '../ports/dose-log-resource.js';

/** Renders a stored row as the API resource. */
export function toDoseLogResource(record: DoseLogRecord): DoseLogResource {
  return {
    id: record.id,
    healthEventId: record.healthEventId,
    currentMedicineId: record.currentMedicineId,
    reminderId: record.reminderId,
    status: record.status,
    scheduledFor: formatDateOnly(record.scheduledFor),
    scheduledTime: record.scheduledTime,
    doseText: record.doseText,
    note: record.note,
    source: record.source,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Renders one page. */
export function toDoseLogListResource(
  items: DoseLogRecord[],
  total: number,
): DoseLogListResource {
  return { items: items.map(toDoseLogResource), total };
}
