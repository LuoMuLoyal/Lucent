/**
 * 记录写入后的公共收尾：入队餐食分析 + 失效建议缓存。
 *
 * 为什么单独一个服务而不是每个用例各写一遍：这三件事的顺序与「失败不影响写入」
 * 的语义必须一致——入队是尽力而为、缓存失效是尽力而为、两者都不能让已经落库的
 * 写入变成 500。
 */
import { Injectable, Logger } from '@nestjs/common';
import { formatDateOnly } from '../../../../common/index.js';
import { MealAnalysisJobs } from '../ports/meal-analysis-jobs.js';
import type { RecordChangeEvents } from '../ports/record-change-events.js';
import type { RecordItem } from '../read_models/record-list.js';
import {
  analysisRevisionToQueue,
  mealAnalysisColumns,
} from './meal-payload.js';

/** 更新链路上「旧值 / 新值」的日期与 kind（跨日更新要发两条失效事件）。 */
export interface RecordChangeTarget {
  previousDate: string | null;
  previousKind: string;
  nextDate: string | null;
  nextKind: string;
}

@Injectable()
export class RecordWriteEffects {
  private readonly logger = new Logger(RecordWriteEffects.name);

  constructor(
    private readonly jobs: MealAnalysisJobs,
    private readonly events: RecordChangeEvents,
  ) {}

  /**
   * 写入后入队餐食分析（只有「餐食 + 恰好一张图 + 仍是 analyzing」才入队）。
   *
   * `sourceRevisionOverride` 用于 payload 已在事务里写好的路径：那时状态已经落成
   * `analyzing`，直接拿刚写的 revision 入队。
   */
  async enqueueMealAnalysis(
    userId: string,
    item: RecordItem,
    payload: Record<string, unknown> | null | undefined,
    sourceRevisionOverride?: number,
  ): Promise<void> {
    const revision = analysisRevisionToQueue(
      item.kind,
      item.attachments.length,
      payload,
      sourceRevisionOverride,
    );
    if (revision == null) {
      return;
    }

    try {
      await this.jobs.enqueue({
        userId,
        recordId: item.id,
        sourceRevision: revision,
      });
    } catch (error) {
      // 队列不可用时适配器已退化为同步执行；这里兜底只记日志——写入不该因此失败。
      this.logger.warn('Failed to enqueue meal analysis job', {
        recordId: item.id,
        error,
      });
    }
  }

  /** 单日单 kind 的失效（创建 / 删除）。 */
  async invalidateDay(
    userId: string,
    occurredAt: string | Date,
    kind?: string,
    recordId?: string,
  ): Promise<void> {
    const date =
      typeof occurredAt === 'string'
        ? formatDateOnly(new Date(occurredAt))
        : formatDateOnly(occurredAt);
    await this.publish({
      userId,
      date,
      ...(kind != null ? { kind } : {}),
      ...(recordId != null ? { recordId } : {}),
    });
  }

  /**
   * 更新链路的失效。
   *
   * 更新可能把记录跨日/跨 kind 移动，所以对「旧日期+旧kind」与「新日期+新kind」
   * 各发一条；同一目标只发一次（`Map` 去重）。否则目标日会继续用过期的建议缓存。
   */
  async invalidateMove(
    userId: string,
    recordId: string,
    target: RecordChangeTarget,
  ): Promise<void> {
    const events = new Map<string, { date: string; kind: string }>();

    if (target.previousDate != null) {
      events.set(`${target.previousDate}:${target.previousKind}`, {
        date: target.previousDate,
        kind: target.previousKind,
      });
    }
    if (target.nextDate != null) {
      events.set(`${target.nextDate}:${target.nextKind}`, {
        date: target.nextDate,
        kind: target.nextKind,
      });
    }

    for (const event of events.values()) {
      await this.publish({ userId, recordId, ...event });
    }
  }

  /** 已落库 payload → 投影列（更新路径把新 payload 写入时用）。 */
  mealColumns(payload: unknown) {
    return mealAnalysisColumns(payload);
  }

  private async publish(event: {
    userId: string;
    date: string;
    kind?: string;
    recordId?: string;
  }): Promise<void> {
    try {
      await this.events.publish(event);
    } catch (error) {
      // cache invalidation is best-effort
      this.logger.warn('Failed to emit daily-record.changed event', {
        userId: event.userId,
        error,
      });
    }
  }
}
