/**
 * Read model: one date's dose logs (`GET /api/v1/user/medicine-dose-logs`).
 *
 * The list is a query, not an aggregate load: it pages a single date and renders
 * each row. Ordering is `scheduledTime asc, createdAt desc` — slot order is what
 * the client renders, and the tie-break keeps paging stable when two rows share a
 * slot (temporary logs can).
 */

import { parseDateOnly } from '../../../../common/helpers/format/date-time.utils.js';
import type { DoseLogs } from '../../domain/dose-log/dose-logs.js';
import type { DoseLogListResource } from '../ports/dose-log-resource.js';
import { toDoseLogListResource } from './dose-log.js';

export class DoseLogsForDate {
  constructor(private readonly repository: DoseLogs) {}

  async get(
    userId: string,
    date: string,
    pagination: { page: number; pageSize: number },
  ): Promise<DoseLogListResource> {
    const { items, total } = await this.repository.listByDate(
      userId,
      parseDateOnly(date),
      pagination,
    );
    return toDoseLogListResource(items, total);
  }
}
