/**
 * 记录归属校验（应用层，读后判定，不承担领域不变量）。
 *
 * ## 为什么需要先按 id 读一行
 *
 * 不能 id+userId 一起查：那样分不清「不存在」与「别人的」。先按 id 取归属投影，
 * 再在内存里判定——`DailyRecord.ownershipFor` 是这个判定的领域版本，这里直接用它，
 * 保证「什么算归属」只有一处定义。
 *
 * ## 对外语义
 *
 * 不存在与别人的记录都返回 `RESOURCE_NOT_FOUND`（不泄漏存在性，ADR-0012 的
 * IDOR 约定）。`FORBIDDEN` 只在健康事件关联校验里出现（上游 façade 的既有语义）。
 */
import { Injectable } from '@nestjs/common';
import {
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { DailyRecord } from '../../domain/record/daily-record.js';
import { DailyRecords } from '../../domain/record/records.js';
import { recordNotFound } from './domain-failures.js';

/** 通过归属校验后携带的旧值快照（更新 / 删除需要）。 */
export interface OwnedRecordSnapshot {
  kind: string;
  payload: unknown;
  occurredAt: Date | null;
}

@Injectable()
export class RecordOwnership {
  constructor(private readonly records: DailyRecords) {}

  /** 校验记录属于该用户；返回旧值快照，不返回整行。 */
  ensure(
    userId: string,
    id: string,
  ): ResultAsync<OwnedRecordSnapshot, DomainFailure> {
    return fromPromise(this.records.findOwnership(id), (error) => {
      throw error;
    }).andThen((row) => {
      if (row == null) {
        return errAsync(recordNotFound());
      }

      const record = DailyRecord.from({
        id,
        userId: row.userId,
        kind: row.kind,
        occurredAt: row.occurredAt,
        payload: row.payload,
        deletedAt: null,
      });
      if (record.ownershipFor(userId) !== 'owned') {
        return errAsync(recordNotFound());
      }

      return okAsync({
        kind: row.kind,
        payload: row.payload,
        occurredAt: row.occurredAt,
      });
    });
  }
}
