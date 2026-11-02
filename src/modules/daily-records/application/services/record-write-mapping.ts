/**
 * 入站 DTO（zod）→ 领域写数据。
 *
 * ## 位置说明
 *
 * `adapters/http` 不能 import `infrastructure/`，`application/` 不能 import
 * `adapters/`。入站 DTO 的**类型**只描述 HTTP 输入，本身不依赖框架；
 * 这个 mapper 因此放在应用层 —— HTTP 控制器与将来的其它入口共用同一条映射，
 * 而不是每个入口各写一遍字段清洗。
 *
 * ## 清洗规则
 *
 * - 文本列：`null` / 空白 → `null`（`normalizeNullableText`），避免库里出现
 *   「空字符串 vs null」两种空值。
 * - `healthEventId`：`undefined` = 不改；`null` = 解除关联。
 * - 餐食 payload 一律走 `prepareMealPayload`（客户端只能改菜名）。
 */
import { normalizeNullableText } from '../../../../common/index.js';
import type { CreateRecordInput, UpdateRecordInput } from './write-input.js';
import { parseOccurredAt } from '../../domain/record/occurred-at.js';
import { isMeal } from '../../domain/record/record-kind.js';
import type {
  AttachmentWriteValues,
  RecordWriteValues,
} from '../../domain/record/records.js';
import { prepareMealPayload, withMealColumns } from './meal-payload.js';

/** 附件输入 DTO 的公共形状（创建与更新共用）。 */
interface AttachmentInput {
  kind?: string | undefined;
  objectKey: string;
  bucket?: string | null | undefined;
  provider?: string | null | undefined;
  fileName?: string | null | undefined;
  contentType?: string | null | undefined;
  sizeBytes?: number | null | undefined;
  width?: number | null | undefined;
  height?: number | null | undefined;
  publicUrl?: string | null | undefined;
}

const DEFAULT_ATTACHMENT_KIND = 'image';

/** 附件 DTO → 写数据（`objectKey` 去空格；其余空值收敛成 null）。 */
export function toAttachmentWrites(
  userId: string,
  recordId: string,
  attachments: ReadonlyArray<AttachmentInput>,
): AttachmentWriteValues[] {
  return attachments.map((attachment) => ({
    userId,
    recordId,
    kind: attachment.kind ?? DEFAULT_ATTACHMENT_KIND,
    objectKey: attachment.objectKey.trim(),
    bucket: normalizeNullableText(attachment.bucket),
    provider: normalizeNullableText(attachment.provider),
    fileName: normalizeNullableText(attachment.fileName),
    contentType: normalizeNullableText(attachment.contentType),
    sizeBytes: attachment.sizeBytes ?? null,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
    publicUrl: normalizeNullableText(attachment.publicUrl),
  }));
}

/**
 * 创建 DTO → 记录写数据（含餐食 payload 与投影列）。
 *
 * `occurredAt` 已经在 DTO 层按 `YYYY-MM-DD` 校验过，这里再解析一次是防御性的：
 * 解析失败按「今天」不可能对，直接抛——DTO 校验是唯一入口。
 */
export function toCreateWriteValues(
  userId: string,
  dto: CreateRecordInput,
): RecordWriteValues {
  // DTO 校验是唯一入口：形状不合法不可能走到这里（走不到就说明校验层漏了）。
  const occurredAt =
    parseOccurredAt(dto.occurredAt) ?? new Date(dto.occurredAt);

  const base: RecordWriteValues = {
    userId,
    kind: dto.kind,
    occurredAt,
    occurredTime: normalizeNullableText(dto.occurredTime),
    title: normalizeNullableText(dto.title),
    value: normalizeNullableText(dto.value),
    unit: normalizeNullableText(dto.unit),
    note: normalizeNullableText(dto.note),
    source: dto.source ?? 'manual',
    healthEventId: dto.healthEventId ?? null,
  };

  if (isMeal(dto.kind)) {
    const mealPayload = prepareMealPayload(dto.payload, dto.attachments);
    return withMealColumns(base, mealPayload);
  }

  return dto.payload === undefined ? base : { ...base, payload: dto.payload };
}

/**
 * 更新 DTO → 记录写数据（只含提交了的字段）。
 *
 * `existing` 提供两个上下文：目标 kind（payload 的清洗规则按它选）与旧 payload
 * （餐食菜名的基线）。
 *
 * 餐食 payload 的重新入队占位（`analyzing` + revision 递增）**不在**这里做：
 * 那是「本次带了恰好一张图」才成立的判定，由用例在附件替换路径上单独准备
 * （见 `prepareMealPayload`），否则只改菜名的 PATCH 会被误判成「重新分析」。
 */
export function toUpdateWriteValues(
  dto: UpdateRecordInput,
  existing: { kind: string; payload: unknown },
): RecordWriteValues {
  const targetKind = dto.kind ?? existing.kind;
  const values: RecordWriteValues = {};

  if (dto.kind !== undefined) values['kind'] = dto.kind;
  if (dto.occurredAt !== undefined) {
    const occurredAt = parseOccurredAt(dto.occurredAt);
    if (occurredAt != null) values['occurredAt'] = occurredAt;
  }
  if (dto.occurredTime !== undefined) {
    values['occurredTime'] = normalizeNullableText(dto.occurredTime);
  }
  if (dto.title !== undefined)
    values['title'] = normalizeNullableText(dto.title);
  if (dto.value !== undefined)
    values['value'] = normalizeNullableText(dto.value);
  if (dto.unit !== undefined) values['unit'] = normalizeNullableText(dto.unit);
  if (dto.note !== undefined) values['note'] = normalizeNullableText(dto.note);
  if (dto.healthEventId !== undefined) {
    values['healthEventId'] = dto.healthEventId;
  }

  if (dto.payload === undefined) {
    return values;
  }

  if (!isMeal(targetKind)) {
    values['payload'] = dto.payload;
    return values;
  }

  // 餐食：只更新菜名（客户端唯一可编辑字段），不重算结论与区间。
  const mealPayload = prepareMealPayload(
    dto.payload,
    undefined,
    existing.payload,
  );
  return withMealColumns(values, mealPayload);
}
