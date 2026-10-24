import {
  exceedsHalfLifeGap,
  parseHalfLife,
  type HalfLifeRange,
} from './half-life.js';

/**
 * 半衰期感知的漏服判定。
 *
 * ## 为什么不能按固定时长判定
 *
 * 现在的漏服提示是「到点没吃就提醒」。同一条规则套在两种药上会说反话：
 *
 * - 半衰期 3 小时的药，漏 6 小时 = 两个半衰期，血药浓度已掉到 25%，**该提醒**；
 * - 半衰期 102 小时的药（依那西普），漏 6 小时 = 6% 一个半衰期，浓度几乎没动，
 *   提醒只会制造焦虑。
 *
 * 判定依据是「缺口占半衰期的比例」，而半衰期来自药品知识——这是有药物数据才能
 * 做出来的提示，通用提醒类 App 做不到。
 *
 * ## 两条硬约束
 *
 * 1. **用下界**（{@link exceedsHalfLifeGap}）：区间宽的药按保守口径算，宁可晚提示
 *    也不误提示。误报会让用户对整个提醒系统失去信任，那比少提示一次更贵。
 * 2. **每天最多一次**（{@link shouldNotify}）：这是防骚扰的硬上限，不是优化项。
 *    一个每天弹三次的提醒等于没有提醒。
 */

/** 一条待判定的剂量记录：计划时间 + 是否已确认。 */
export interface DoseGapInput {
  /** 计划服药时间（带日期与时刻），已由调用方按用户时区组装。 */
  readonly scheduledAt: Date;
  /** 是否已确认服用。已服用 / 已跳过的记录不参与判定。 */
  readonly isConfirmed: boolean;
}

/** 判定所需的最小上下文。 */
export interface HalfLifeGapContext {
  /** 该药 `half_life` 原文；为空表示没有可用数据。 */
  readonly halfLifeText: string | null | undefined;
  /** 用户当前时间。 */
  readonly now: Date;
  /** 最近一次因该药发出的漏服提示时间；用于每日上限。 */
  readonly lastNotifiedAt: Date | null;
}

export type HalfLifeGapOutcome =
  | {
      /** 缺口确实跨过了阈值，应该提示。 */
      readonly status: 'notify';
      readonly gapHours: number;
      readonly range: HalfLifeRange;
    }
  | {
      /** 缺口不够大，不提示。 */
      readonly status: 'belowThreshold';
      readonly gapHours: number;
      readonly range: HalfLifeRange;
    }
  | {
      /** 今天已经提示过。 */
      readonly status: 'throttled';
      readonly gapHours: number;
    }
  | {
      /** 没有可解析的半衰期，无法判定。 */
      readonly status: 'noData';
    };

const MS_PER_HOUR = 3_600_000;

/**
 * 判定是否应为一条漏服记录发出提示。
 *
 * @param dose 待判定的剂量记录。
 * @param context 半衰期原文与节流状态。
 * @returns 判别式结果；`noData` 时调用方应**保持原有提醒逻辑**，而不是更激进或更保守。
 */
export function evaluateHalfLifeGap(
  dose: DoseGapInput,
  context: HalfLifeGapContext,
): HalfLifeGapOutcome {
  if (dose.isConfirmed) {
    return { status: 'noData' };
  }

  const range = parseHalfLife(context.halfLifeText);
  if (range === null) {
    return { status: 'noData' };
  }

  const gapHours =
    (context.now.getTime() - dose.scheduledAt.getTime()) / MS_PER_HOUR;

  // 还没到时间的记录不是「漏服」。
  if (gapHours < 0) {
    return { status: 'belowThreshold', gapHours, range };
  }

  if (!exceedsHalfLifeGap(range, gapHours)) {
    return { status: 'belowThreshold', gapHours, range };
  }

  if (
    context.lastNotifiedAt !== null &&
    isSameLocalDay(context.lastNotifiedAt, context.now)
  ) {
    return { status: 'throttled', gapHours };
  }

  return { status: 'notify', gapHours, range };
}

/**
 * 两个时刻是否落在同一个自然日（按服务器本地时区）。
 *
 * 每日上限用**自然日**而非「滚动 24 小时」：用户看到的「今天已经提醒过」
 * 与日历一致，才符合直觉；滚动窗口会让同一天里提示两次而在跨零点时意外放行。
 */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
