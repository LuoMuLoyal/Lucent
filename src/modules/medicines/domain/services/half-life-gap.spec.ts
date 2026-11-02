import { describe, expect, it } from 'vitest';

import { evaluateHalfLifeGap } from './half-life-gap.js';

/**
 * 半衰期感知的漏服判定。
 *
 * 这组用例的核心是**两条边界**：用下界判定（不误报）与每日上限（不骚扰）。
 * 两者都是产品约束，不是实现细节——放松任何一条，这个功能就会变成噪音源。
 */
const HOUR = 3_600_000;
const NOW = new Date('2026-10-24T20:00:00');

/** 计划时间距现在 `hours` 小时（正数表示已过去）。 */
function scheduledHoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

describe('evaluateHalfLifeGap', () => {
  it('does not fire when the gap is below half of the lower bound', () => {
    // 3 小时的药，下界的一半是 1.5 小时；缺口 1 小时不提示。
    const outcome = evaluateHalfLifeGap(
      { scheduledAt: scheduledHoursAgo(1), isConfirmed: false },
      { halfLifeText: '3 hours', now: NOW, lastNotifiedAt: null },
    );

    expect(outcome.status).toBe('belowThreshold');
  });

  it('fires when the gap crosses half of the lower bound', () => {
    const outcome = evaluateHalfLifeGap(
      { scheduledAt: scheduledHoursAgo(2), isConfirmed: false },
      { halfLifeText: '3 hours', now: NOW, lastNotifiedAt: null },
    );

    expect(outcome.status).toBe('notify');
  });

  it('stays quiet for a long half-life drug where the same gap is negligible', () => {
    // 同一个 6 小时缺口：对半衰期 3 小时的药要提醒，对 102 小时的药不该提醒。
    // 这正是「固定时长规则」做不到、而半衰期规则能做的事。
    const short = evaluateHalfLifeGap(
      { scheduledAt: scheduledHoursAgo(6), isConfirmed: false },
      { halfLifeText: '3 hours', now: NOW, lastNotifiedAt: null },
    );
    const long = evaluateHalfLifeGap(
      { scheduledAt: scheduledHoursAgo(6), isConfirmed: false },
      { halfLifeText: '102 hours', now: NOW, lastNotifiedAt: null },
    );

    expect(short.status).toBe('notify');
    expect(long.status).toBe('belowThreshold');
  });

  it('is conservative on wide ranges', () => {
    // 8.4-19.3 小时 → 上界一半是 9.65 小时。缺口 5 小时不提示；
    // 若误用下界口径（阈值 4.2）就会提示，这条用例正是为了钉住那个错误。
    const quiet = evaluateHalfLifeGap(
      { scheduledAt: scheduledHoursAgo(5), isConfirmed: false },
      { halfLifeText: '8.4-19.3 hrs', now: NOW, lastNotifiedAt: null },
    );
    const fires = evaluateHalfLifeGap(
      { scheduledAt: scheduledHoursAgo(10), isConfirmed: false },
      { halfLifeText: '8.4-19.3 hrs', now: NOW, lastNotifiedAt: null },
    );

    expect(quiet.status).toBe('belowThreshold');
    expect(fires.status).toBe('notify');
  });

  it('never fires for an already-confirmed dose', () => {
    const outcome = evaluateHalfLifeGap(
      { scheduledAt: scheduledHoursAgo(48), isConfirmed: true },
      { halfLifeText: '3 hours', now: NOW, lastNotifiedAt: null },
    );

    expect(outcome.status).toBe('noData');
  });

  it('never fires for a dose that is not yet due', () => {
    const outcome = evaluateHalfLifeGap(
      { scheduledAt: scheduledHoursAgo(-5), isConfirmed: false },
      { halfLifeText: '3 hours', now: NOW, lastNotifiedAt: null },
    );

    expect(outcome.status).toBe('belowThreshold');
  });

  it('throttles to one notification per local day', () => {
    // 防骚扰是硬约束：同一天已经提示过就不再提示。
    const outcome = evaluateHalfLifeGap(
      { scheduledAt: scheduledHoursAgo(6), isConfirmed: false },
      {
        halfLifeText: '3 hours',
        now: NOW,
        lastNotifiedAt: new Date('2026-10-24T09:00:00'),
      },
    );

    expect(outcome.status).toBe('throttled');
  });

  it('allows a new notification on the next day', () => {
    const outcome = evaluateHalfLifeGap(
      { scheduledAt: scheduledHoursAgo(6), isConfirmed: false },
      {
        halfLifeText: '3 hours',
        now: NOW,
        lastNotifiedAt: new Date('2026-10-23T09:00:00'),
      },
    );

    expect(outcome.status).toBe('notify');
  });

  it('reports noData when the half-life text is unparseable', () => {
    // 没有数据时调用方应保持原有逻辑，而不是变得更激进或更保守。
    const outcome = evaluateHalfLifeGap(
      { scheduledAt: scheduledHoursAgo(10), isConfirmed: false },
      { halfLifeText: 'Not applicable.', now: NOW, lastNotifiedAt: null },
    );

    expect(outcome.status).toBe('noData');
  });

  it('reports noData when half_life is missing entirely', () => {
    const outcome = evaluateHalfLifeGap(
      { scheduledAt: scheduledHoursAgo(10), isConfirmed: false },
      { halfLifeText: null, now: NOW, lastNotifiedAt: null },
    );

    expect(outcome.status).toBe('noData');
  });
});
