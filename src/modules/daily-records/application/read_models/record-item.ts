/**
 * 记录行 → 读模型条目的投影（纯函数，没有 DI、没有 IO）。
 *
 * 为什么单独一个文件而不是 presenter 的方法：这条投影被三处用到——HTTP
 * presenter（列表/详情/汇总）、写用例（写完立刻回读的响应）与餐食管线（入队判定
 * 需要 item 形状）。放在应用层让它们共用一个事实源。
 *
 * 两条容易踩的约定：
 *
 * - 餐食记录 `payload` 只在**详情**读返回（`includeMealPayload`），列表读恒为
 *   `null`——列表靠投影列，不必解析 JSONB。
 * - 每条记录都**输出全部键**（null 也显式给），与 response schema 的 required 对齐。
 */
import { formatOccurredAt } from '../../domain/record/occurred-at.js';
import type { RecordRow } from '../../domain/record/record-row.js';
import type { RecordItem, RecordSummary } from './record-list.js';

export interface RecordItemOptions {
  /** 详情读：返回餐食 payload 里的完整分析。 */
  includeMealPayload?: boolean;
}

type PlainPayload = Record<string, unknown> | null;

function asObjectPayload(raw: unknown): PlainPayload {
  return raw != null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

export function toRecordItem(
  row: RecordRow,
  options: RecordItemOptions = {},
): RecordItem {
  const isMeal = row.kind === 'meal';
  const hidden = isMeal && options.includeMealPayload !== true;

  return {
    id: row.id,
    kind: row.kind,
    healthEventId: row.healthEventId,
    occurredAt: formatOccurredAt(row.occurredAt),
    occurredTime: row.occurredTime,
    title: row.title,
    value: row.value,
    unit: row.unit,
    note: row.note,
    source: row.source,
    payload: hidden ? null : asObjectPayload(row.payload),
    mealAnalysisStatus: row.mealAnalysisStatus,
    mealAnalysisUpdatedAt: row.mealAnalysisUpdatedAt?.toISOString() ?? null,
    mealAnalysisFailureReason: row.mealAnalysisFailureReason,
    mealHeadline: row.mealHeadline,
    mealCalorieMin: row.mealCalorieMin,
    mealCalorieMax: row.mealCalorieMax,
    mealCalorieBucket: row.mealCalorieBucket,
    attachments: row.attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      objectKey: attachment.objectKey,
      bucket: attachment.bucket,
      provider: attachment.provider,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      width: attachment.width,
      height: attachment.height,
      publicUrl: attachment.publicUrl,
      createdAt: attachment.createdAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 按 kind 汇总一天：`count` 是条数，`latest` 是该 kind 的**第一条**
 * （仓储已按 `occurredTime desc nulls last, createdAt desc` 排序）。
 */
export function toRecordSummary(rows: RecordRow[]): RecordSummary {
  const byKind = new Map<string, RecordRow[]>();
  for (const row of rows) {
    const list = byKind.get(row.kind) ?? [];
    list.push(row);
    byKind.set(row.kind, list);
  }

  return {
    summaries: Array.from(byKind.entries()).map(([kind, items]) => ({
      kind,
      count: items.length,
      latest: items[0] != null ? toRecordItem(items[0]) : null,
    })),
  };
}
