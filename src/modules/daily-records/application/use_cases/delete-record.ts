/**
 * 软删除日报记录（用例）。
 *
 * 软删除（`deletedAt`）而不是物理删除：记录是健康档案的一部分，下游报告/建议
 * 可能仍在引用它；物理删除会把历史事实一起抹掉。
 *
 * 删除后失效它自己那一天的建议缓存——否则当天的建议会继续把这条记录算进去。
 */
import { Injectable } from '@nestjs/common';
import {
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { now } from '../../../../common/index.js';
import { DailyRecords } from '../../domain/record/records.js';
import { RecordOwnership } from '../services/record-ownership.js';
import { RecordWriteEffects } from '../services/record-write-effects.js';

@Injectable()
export class DeleteRecord {
  constructor(
    private readonly records: DailyRecords,
    private readonly ownership: RecordOwnership,
    private readonly effects: RecordWriteEffects,
  ) {}

  execute(userId: string, id: string): ResultAsync<void, DomainFailure> {
    return this.ownership
      .ensure(userId, id)
      .andThen((existing) =>
        fromPromise(this.records.softDelete(id, now()), (error) => {
          throw error;
        }).map(() => existing),
      )
      .map(async (existing) => {
        if (existing.occurredAt != null) {
          await this.effects.invalidateDay(
            userId,
            existing.occurredAt,
            existing.kind,
            id,
          );
        }
      });
  }
}
