/**
 * 记录类型的领域词汇。
 *
 * 为什么不再从 `#generated/prisma/client.js` 的 `DailyRecordKind` 直取：
 * ADR-0024 的 `ddd-domain-purity` 禁止 `domain/**` import 任何框架/生成物。
 * 这里的取值与 Prisma enum **逐字一致**（wire 契约不变），由
 * `record-kind.spec.ts` 与 Prisma enum 对账——漂移会让测试先红，而不是等
 * 生产环境写库失败。
 */

export const DAILY_RECORD_KINDS = [
  'water',
  'meal',
  'vital',
  'mood',
  'symptom',
  'activity',
  'note',
  'sleep',
] as const;

export type DailyRecordKind = (typeof DAILY_RECORD_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(DAILY_RECORD_KINDS);

/** 把任意字符串收敛成已知 kind；不认识返回 `null`（不做静默回落）。 */
export function asDailyRecordKind(raw: string): DailyRecordKind | null {
  return KIND_SET.has(raw) ? (raw as DailyRecordKind) : null;
}

/** 只有餐食记录有分析管线。 */
export function isMeal(kind: string): boolean {
  return kind === 'meal';
}
