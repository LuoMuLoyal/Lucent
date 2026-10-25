/**
 * 读取单条日报记录（读用例）。
 *
 * 归属校验先行：不存在与别人的记录都返回 `RESOURCE_NOT_FOUND`。
 * 详情读返回完整餐食 payload（`items` / `dishes`），列表读才用投影列。
 */
import { Injectable } from '@nestjs/common';
import {
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { DailyRecords } from '../../domain/record/records.js';
import type { RecordItem } from '../read_models/record-list.js';
import { toRecordItem } from '../read_models/record-item.js';
import { recordNotFound } from '../services/domain-failures.js';
import { RecordOwnership } from '../services/record-ownership.js';

@Injectable()
export class GetRecord {
  constructor(
    private readonly records: DailyRecords,
    private readonly ownership: RecordOwnership,
  ) {}

  execute(userId: string, id: string): ResultAsync<RecordItem, DomainFailure> {
    return this.ownership
      .ensure(userId, id)
      .andThen(() =>
        fromPromise(this.records.findById(id), (error) => {
          throw error;
        }),
      )
      .andThen((row) => {
        // 只在归属校验与读取之间的竞态里可达：按「不存在」处理。
        if (row == null) {
          return errAsync(recordNotFound());
        }
        return okAsync(toRecordItem(row, { includeMealPayload: true }));
      });
  }
}
