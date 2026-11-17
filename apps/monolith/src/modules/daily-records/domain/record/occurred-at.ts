/**
 * 记录发生日期（值对象）。
 *
 * 记录按 `YYYY-MM-DD` 归档：一天的边界是 UTC 日界，与库里的 `@db.Date` 列同源。
 * 这里把「解析 / 格式化 / 同日比较」收敛成三个纯函数，写路径与读模型都用它们，
 * 避免各处手写 `new Date(string)` 的时区差异。
 */

/** `YYYY-MM-DD` 前缀长度（从 ISO 时间戳切日期用）。 */
const DATE_ONLY_LENGTH = 10;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 解析 `YYYY-MM-DD`（或 ISO 时间戳）为 UTC 零点的日期。
 *
 * 形状不合法时返回 `null`，由调用方决定是校验失败还是回落——领域层不抛异常。
 */
export function parseOccurredAt(raw: string): Date | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const date = new Date(
    DATE_ONLY_PATTERN.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 日期 → `YYYY-MM-DD`。 */
export function formatOccurredAt(date: Date): string {
  return date.toISOString().slice(0, DATE_ONLY_LENGTH);
}

/** 两个时间点是否落在同一个记录日。 */
export function isSameRecordDay(left: Date, right: Date): boolean {
  return formatOccurredAt(left) === formatOccurredAt(right);
}
