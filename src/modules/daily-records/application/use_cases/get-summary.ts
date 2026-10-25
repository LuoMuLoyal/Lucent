/**
 * 某一天按 kind 的汇总（读用例）。
 *
 * `latest` 取该 kind 的第一条——仓储已按
 * `occurredTime desc nulls last, createdAt desc` 排序，所以「第一条」就是最近的一条。
 */
import { Injectable } from '@nestjs/common';
import { parseDateOnly } from '../../../../common/index.js';
import type { DailyRecords } from '../../domain/record/records.js';
import type { RecordSummary } from '../read_models/record-list.js';
import { toRecordSummary } from '../read_models/record-item.js';

@Injectable()
export class GetSummary {
  constructor(private readonly records: DailyRecords) {}

  async execute(userId: string, date: string): Promise<RecordSummary> {
    const rows = await this.records.listByDay(userId, parseDateOnly(date));
    return toRecordSummary(rows);
  }
}
