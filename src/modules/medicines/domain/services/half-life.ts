/**
 * 半衰期文本解析。
 *
 * ## 为什么需要解析器而不是直接读数字
 *
 * DrugBank 的 `half_life` 是**叙述文本**，不是数值列。实测 78 条非空样本里既有
 * `4-5 hours` 这样的短值，也有
 * `Etanercept has a mean half-life of elimination of 102 hours in RA patients.
 * Population models have shown a mean half-life of 68 hours ...` 这样的多句描述。
 *
 * ## 为什么返回区间而不是单值
 *
 * 33/78 条是区间（`4-5 hours`、`8.4-19.3 hrs`）。取中点会把「不确定」伪装成
 * 「精确」，而这个数字后续要参与「缺口是否跨过半个半衰期」的判定——
 * 用错值会让提示要么太吵要么太迟钝。所以保留 `[low, high]`，
 * 判定时用**上界**：只有缺口连「最慢的那个半衰期估计」都跨过了才提示。
 *
 * ## 解析失败的语义
 *
 * 返回 `null` 表示「这段文本里没有可用的半衰期」，调用方据此跳过该药，
 * **不要**回落到一个默认值——那等于给一个我们自己编的生理参数。
 */

/** 一个半衰期区间，单位统一为小时。 */
export interface HalfLifeRange {
  /** 下界（小时）。 */
  readonly lowHours: number;
  /** 上界（小时）。等于 `lowHours` 时表示原文是单值。 */
  readonly highHours: number;
  /** 原文是否带比较符（`>20 hours`），此时 `lowHours` 是下界而非精确值。 */
  readonly openEnded: boolean;
}

/** 正则捕获组下标：VALUE_PATTERN 的第 1/2/3 组分别是下限、上限、单位。 */
const GROUP_LOW = 1;
const GROUP_HIGH = 2;
const GROUP_UNIT = 3;

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** 英文数字词 → 数值。DrugBank 里确实会出现 `three hours` 这种写法。 */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  twenty: 20,
  thirty: 30,
};

/**
 * 匹配「数字（区间）单位」。
 *
 * 覆盖的写法来自实测样本：
 * - `4-5 hours` / `8.4-19.3 hrs` / `84-353 hours`（连字符区间）
 * - `25 ± 10 hours`（正负号，按 `25±10` 展开为区间）
 * - `>20 hours` / `approximately three hours`（前缀词不参与匹配，只需拿到数字）
 * - `112 minutes` / `3 days`
 */
const VALUE_PATTERN =
  /(\d+(?:\.\d+)?)\s*(?:(?:-|–|to|±|\+\/-)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|h|minutes?|mins?|days?)\b/i;

/** 英文数字词形态：`three hours`。只在数字匹配失败时尝试。 */
const WORD_VALUE_PATTERN =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty)\s+(hours?|hrs?|minutes?|mins?|days?)\b/i;

/** 比较符紧贴在数值前：`>20 hours`、`≥ 4 h`。 */
const OPEN_ENDED_PATTERN = /(?:>|greater than|at least)\s*$/i;

/**
 * 从半衰期文本里解析出小时区间。
 *
 * @param text DrugBank `half_life` 原文。
 * @returns 解析出的区间；文本里没有可用数值时返回 `null`。
 */
export function parseHalfLife(
  text: string | null | undefined,
): HalfLifeRange | null {
  if (text === null || text === undefined) return null;
  const normalized = text.trim();
  if (normalized === '') return null;

  const numeric = VALUE_PATTERN.exec(normalized);
  const firstGroup = numeric?.[GROUP_LOW];
  const unitGroup = numeric?.[GROUP_UNIT];
  if (numeric !== null && firstGroup !== undefined && unitGroup !== undefined) {
    const first = Number.parseFloat(firstGroup);
    const secondGroup = numeric[GROUP_HIGH];
    const second =
      secondGroup === undefined ? undefined : Number.parseFloat(secondGroup);
    const factor = unitToFactor(unitGroup.toLowerCase());

    // `25 ± 10 hours` 在正则里被读成 (25, 10)：正负号两侧是「中心±偏差」，
    // 不是区间端点。按中心值上下展开，而不是把 25 当成上界、10 当成下界。
    const isPlusMinus = /\d\s*(?:±|\+\/-)/.test(numeric[0]);
    const low = isPlusMinus ? first - (second ?? 0) : first;
    const high = isPlusMinus ? first + (second ?? 0) : (second ?? first);

    return buildRange(
      Math.min(low, high) * factor,
      Math.max(low, high) * factor,
      OPEN_ENDED_PATTERN.test(normalized.slice(0, numeric.index)),
    );
  }

  const words = WORD_VALUE_PATTERN.exec(normalized);
  const wordValue = words?.[1];
  const wordUnit = words?.[2];
  if (wordValue !== undefined && wordUnit !== undefined) {
    const value = NUMBER_WORDS[wordValue.toLowerCase()];
    if (value === undefined) return null;
    const hours = value * unitToFactor(wordUnit.toLowerCase());
    return buildRange(hours, hours, false);
  }

  return null;
}

/**
 * 缺口判定：漏服时长是否已跨过**上界**的半个半衰期。
 *
 * ## 为什么用上界（偏晚触发）
 *
 * 这类提示的价值在于「少而准」。区间宽的药（`8.4-19.3 hrs`）用下界口径时
 * 阈值是 4.2 小时，缺口 5 小时就提示；用上界口径阈值是 9.65 小时，
 * 缺口 5 小时不提示。
 *
 * **误报的代价更高**：一个每天多弹几次的提醒会让用户对整个提醒系统失去信任，
 * 那比少提示一次贵得多。所以口径取「宁可晚提示」。
 *
 * 代价要写清：对半衰期短、区间宽的药，提醒会明显延后——这是有意的取舍，
 * 不是遗漏。
 *
 * @param range 解析出的半衰期区间。
 * @param gapHours 计划服药与实际（或当前时刻）之间的小时数。
 * @returns 缺口是否超过半个半衰期的**上界**。
 */
export function exceedsHalfLifeGap(
  range: HalfLifeRange,
  gapHours: number,
): boolean {
  const threshold = range.highHours / 2;
  // 半衰期解析成 0（异常数据）时不应触发提示。
  if (threshold <= 0) return false;
  return gapHours >= threshold;
}

function unitToFactor(unit: string): number {
  if (unit.startsWith('min')) return 1 / MINUTES_PER_HOUR;
  if (unit.startsWith('d')) return HOURS_PER_DAY;
  return 1;
}

function buildRange(
  low: number,
  high: number,
  openEnded: boolean,
): HalfLifeRange | null {
  // 非有限值与负数都是解析噪音（`NaN`、`-` 开头的残片），按失败处理。
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high < 0)
    return null;
  return { lowHours: low, highHours: high, openEnded };
}
