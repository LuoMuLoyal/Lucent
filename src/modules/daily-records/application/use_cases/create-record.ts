/**
 * 创建日报记录（用例）。
 *
 * ## 流程
 *
 * 1. payload 形状校验（领域规则，按 kind）
 * 2. 关联健康事件的归属 / 活跃校验（跨上下文读）
 * 3. 组装写数据（餐食走 payload 写路径：菜名清洗 + 入队占位 + 投影列）
 * 4. 落库：带附件时「记录 + 附件」一个事务；不带附件直接写
 * 5. 事务外收尾：入队餐食分析、失效当天建议缓存
 *
 * ## 为什么第 4 步要分两条路径
 *
 * 带附件时必须保证「记录与附件一起出现」：先建记录再写附件如果中途失败，会留下
 * 一条没有图的餐食记录（永远不会被分析，也看不出是坏的）。不带附件时没有这个
 * 风险，走单写少一次事务开销。
 */
import { Injectable } from '@nestjs/common';
import {
  errAsync,
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import type { CreateRecordInput } from '../services/write-input.js';
import { DailyRecord } from '../../domain/record/daily-record.js';
import { asDailyRecordKind } from '../../domain/record/record-kind.js';
import type { RecordRow } from '../../domain/record/record-row.js';
import { DailyRecords } from '../../domain/record/records.js';
import type { RecordItem } from '../read_models/record-list.js';
import { toRecordItem } from '../read_models/record-item.js';
import { validationFailed } from '../services/domain-failures.js';
import { HealthEventLink } from '../services/health-event-link.js';
import { getMealSourceRevision } from '../../domain/meal/meal-analysis.js';
import {
  toAttachmentWrites,
  toCreateWriteValues,
} from '../services/record-write-mapping.js';
import { RecordWriteEffects } from '../services/record-write-effects.js';

@Injectable()
export class CreateRecord {
  constructor(
    private readonly records: DailyRecords,
    private readonly healthEvents: HealthEventLink,
    private readonly effects: RecordWriteEffects,
  ) {}

  execute(
    userId: string,
    dto: CreateRecordInput,
  ): ResultAsync<RecordItem, DomainFailure> {
    const kind = asDailyRecordKind(dto.kind) ?? 'note';
    const problem = DailyRecord.validatePayload(kind, dto.payload);
    if (problem != null) {
      return errAsync(validationFailed());
    }

    const healthEventId = dto.healthEventId ?? null;
    return this.healthEvents
      .requireActive(userId, healthEventId)
      .andThen(() => this.persist(userId, dto, healthEventId));
  }

  private persist(
    userId: string,
    dto: CreateRecordInput,
    healthEventId: string | null,
  ): ResultAsync<RecordItem, DomainFailure> {
    const values = toCreateWriteValues(userId, dto);
    const attachments = dto.attachments ?? [];

    if (attachments.length === 0) {
      return fromPromise(this.records.insert(values), (error) => {
        throw error;
      }).andThen((row) => this.finish(userId, dto, row));
    }

    return fromPromise(
      this.records.transaction(async (tx) => {
        const row = await tx.insert({ ...values, healthEventId });
        await tx.replaceAttachments(
          userId,
          row.id,
          toAttachmentWrites(userId, row.id, attachments),
        );
        const stored = await tx.findById(row.id);
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
    ).andThen((row) => this.finish(userId, dto, row));
  }

  /**
   * 事务外收尾：用刚写入的 revision 入队（payload 已在库里落成 `analyzing`），
   * 并失效当天的建议缓存。
   */
  private finish(
    userId: string,
    dto: CreateRecordInput,
    row: RecordRow,
  ): ResultAsync<RecordItem, DomainFailure> {
    const item = toRecordItem(row, { includeMealPayload: true });
    const queuedRevision =
      row.kind === 'meal' && row.attachments.length === 1
        ? getMealSourceRevision(row.payload)
        : undefined;

    return fromPromise(
      (async () => {
        await this.effects.enqueueMealAnalysis(
          userId,
          item,
          item.payload,
          queuedRevision,
        );
        await this.effects.invalidateDay(
          userId,
          dto.occurredAt,
          dto.kind,
          item.id,
        );
        return item;
      })(),
      (error) => {
        throw error;
      },
    );
  }
}
