/**
 * 更新日报记录（用例）。
 *
 * ## 流程
 *
 * 1. 归属校验（拿到旧值快照）
 * 2. 关联健康事件的归属 / 活跃校验（仅在提交了 `healthEventId` 且非 null 时）
 * 3. payload 终态校验（睡眠记录：起止成对、时长为正）
 * 4. 组装写数据：餐食按「客户端只能改菜名」重算 payload + 投影列；
 *    带附件时附件集**整体替换**（先清空再写入，与记录更新同一个事务）
 * 5. 事务外：入队餐食分析、对旧日期与新日期各发一条缓存失效
 *
 * ## 为什么附件走整体替换
 *
 * 附件的语义是「这条记录的图片集」：客户端每次提交完整列表。增量 diff 会让
 * 「删掉最后一张图」与「不改图」在协议上无法区分（空数组 vs 字段缺失），
 * 而替换语义天然支持「重新分析 = 换一张图」。
 */
import { Injectable } from '@nestjs/common';
import {
  errAsync,
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import type { UpdateRecordInput } from '../services/write-input.js';
import { formatOccurredAt } from '../../domain/record/occurred-at.js';
import { DailyRecord } from '../../domain/record/daily-record.js';
import { getMealSourceRevision } from '../../domain/meal/meal-analysis.js';
import {
  asDailyRecordKind,
  type DailyRecordKind,
} from '../../domain/record/record-kind.js';
import type { RecordRow } from '../../domain/record/record-row.js';
import { DailyRecords } from '../../domain/record/records.js';
import type { RecordItem } from '../read_models/record-list.js';
import { toRecordItem } from '../read_models/record-item.js';
import { validationFailed } from '../services/domain-failures.js';
import { HealthEventLink } from '../services/health-event-link.js';
import { RecordOwnership } from '../services/record-ownership.js';
import {
  toAttachmentWrites,
  toUpdateWriteValues,
} from '../services/record-write-mapping.js';
import { RecordWriteEffects } from '../services/record-write-effects.js';
import { prepareMealPayload } from '../services/meal-payload.js';

@Injectable()
export class UpdateRecord {
  constructor(
    private readonly records: DailyRecords,
    private readonly ownership: RecordOwnership,
    private readonly healthEvents: HealthEventLink,
    private readonly effects: RecordWriteEffects,
  ) {}

  execute(
    userId: string,
    id: string,
    dto: UpdateRecordInput,
  ): ResultAsync<RecordItem, DomainFailure> {
    return this.ownership.ensure(userId, id).andThen((existing) => {
      const targetKind: DailyRecordKind =
        (dto.kind != null ? asDailyRecordKind(dto.kind) : null) ??
        asDailyRecordKind(existing.kind) ??
        'note';

      return this.healthEvents
        .requireActive(userId, dto.healthEventId ?? null)
        .andThen(() => {
          const problem = DailyRecord.validateFinalState({
            kind: targetKind,
            payload: dto.payload !== undefined ? dto.payload : existing.payload,
          });
          if (problem != null) {
            return errAsync(validationFailed());
          }
          return this.persist(userId, id, dto, existing, targetKind);
        });
    });
  }

  private persist(
    userId: string,
    id: string,
    dto: UpdateRecordInput,
    existing: { kind: string; payload: unknown; occurredAt: Date | null },
    targetKind: string,
  ): ResultAsync<RecordItem, DomainFailure> {
    const values = toUpdateWriteValues(dto, existing);
    const attachments = dto.attachments;
    if (attachments === undefined) {
      return fromPromise(this.records.update(id, values), (error) => {
        throw error;
      }).andThen((row) => this.finish(userId, id, dto, existing, row));
    }

    // 附件整体替换：与记录更新同一个事务，避免「图换了但记录没换」。
    // 恰好一张图 = 新建分析或重新分析（payload 里的 revision 已递增）。
    const mealPayload =
      targetKind === 'meal'
        ? prepareMealPayload(dto.payload, attachments, existing.payload)
        : null;

    return fromPromise(
      this.records.transaction(async (tx) => {
        await tx.update(id, values);
        await tx.replaceAttachments(
          userId,
          id,
          toAttachmentWrites(userId, id, attachments),
        );
        const stored = await tx.findById(id);
        if (stored == null) {
          // 写成功后回读不到行 = 数据库/编程不变量被破坏，不是可预期的领域失败。
          // eslint-disable-next-line error-handling/no-bare-throw-error
          throw new Error(
            'Daily record invariant violated: expected row missing after write',
          );
        }
        return stored;
      }),
      (error) => {
        throw error;
      },
    ).andThen((stored) =>
      this.finish(
        userId,
        id,
        dto,
        existing,
        stored,
        mealPayload == null ? undefined : getMealSourceRevision(mealPayload),
      ),
    );
  }

  private finish(
    userId: string,
    id: string,
    dto: UpdateRecordInput,
    existing: { kind: string; payload: unknown; occurredAt: Date | null },
    row: RecordRow,
    sourceRevisionOverride?: number,
  ): ResultAsync<RecordItem, DomainFailure> {
    const item = toRecordItem(row, { includeMealPayload: true });
    const previousDate =
      existing.occurredAt != null
        ? formatOccurredAt(existing.occurredAt)
        : null;
    const nextDate =
      dto.occurredAt !== undefined
        ? formatOccurredAt(new Date(`${dto.occurredAt.trim()}T00:00:00.000Z`))
        : previousDate;

    return fromPromise(
      (async () => {
        await this.effects.enqueueMealAnalysis(
          userId,
          item,
          item.payload,
          sourceRevisionOverride,
        );
        await this.effects.invalidateMove(userId, id, {
          previousDate,
          previousKind: existing.kind,
          nextDate,
          nextKind: dto.kind ?? existing.kind,
        });
        return item;
      })(),
      (error) => {
        throw error;
      },
    );
  }
}

/** 供控制器复用：记录消失（并发删除）时的错误。 */
