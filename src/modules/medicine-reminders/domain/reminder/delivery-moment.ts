/**
 * 提醒投递时刻换算工具（scheduler 与本地回执接口共用）。
 *
 * 约定：`scheduledFor` 一律为「用户墙钟时刻在用户时区下换算得到的 UTC
 * 时刻、截断到分钟」；profile 时区缺失时回退 [DEFAULT_TIMEZONE]。
 * 已知假设：设备本地时区 ≈ 用户 profile 时区（见 ADR-0013）。
 */

/** 用户 profile 未设置时区时的默认时区。 */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/**
 * 返回给定 UTC 时刻在指定时区下的本地日期字符串（YYYY-MM-DD）。
 * 使用 `en-CA` locale 原生输出 ISO 风格日期。
 */
export function formatLocalDate(date: Date, timezone: string | null): string {
  const tz = timezone || DEFAULT_TIMEZONE;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return `${readPart(parts, 'year', '1970')}-${readPart(parts, 'month', '01')}-${readPart(parts, 'day', '01')}`;
}

/**
 * 将「墙钟日期（YYYY-MM-DD）+ 墙钟时间（HH:mm）」在指定时区下换算为
 * UTC 时刻并截断到分钟，作为投递行的 `scheduledFor`。
 *
 * 实现方式：先把墙钟时刻当作 UTC 构造一个候选 instant，再用
 * `Intl.DateTimeFormat` 求该 instant 在目标时区的 UTC 偏移，回推得到真实
 * instant。秒与毫秒恒为 0，天然满足「截断到分钟」。
 *
 * 注意：偏移量取候选 instant 所在时段的 DST 规则；若墙钟时刻落在 DST
 * 跳变间隙内，结果与该小时前后的一小时近似一致——提醒投递按分钟对齐，
 * 该边界可接受（scheduler 侧按墙钟时分匹配，天然避开不存在的墙钟时刻）。
 */
export function wallClockToScheduledFor(
  dateStr: string,
  timeStr: string,
  timezone: string | null,
): Date {
  const tz = timezone || DEFAULT_TIMEZONE;
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const [hourStr, minuteStr] = timeStr.split(':');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  // 候选 instant：墙钟时刻按 UTC 解释。
  const candidate = new Date(
    Date.UTC(year, month - 1, day, hour, minute, 0, 0),
  );

  const offsetMs = getUtcOffsetMs(candidate, tz);
  // UTC = 墙钟 - 偏移（东八区偏移 +8h，墙钟 08:30 → UTC 00:30）。
  return new Date(candidate.getTime() - offsetMs);
}

/**
 * 返回给定 instant 在指定 IANA 时区下的 UTC 偏移量（毫秒）。
 * 东八区为正值（+8h），西时区为负值（-4h 等）。
 */
function getUtcOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const year = Number(readPart(parts, 'year', '1970'));
  const month = Number(readPart(parts, 'month', '01')) - 1;
  const day = Number(readPart(parts, 'day', '01'));
  const hour = Number(readPart(parts, 'hour', '00')) % 24;
  const minutePart = Number(readPart(parts, 'minute', '00'));
  const second = Number(readPart(parts, 'second', '00'));

  const asUtc = Date.UTC(year, month, day, hour, minutePart, second);
  return asUtc - date.getTime();
}

function readPart(
  parts: Intl.DateTimeFormatPart[],
  type: string,
  fallback: string,
): string {
  return parts.find((part) => part.type === type)?.value ?? fallback;
}
