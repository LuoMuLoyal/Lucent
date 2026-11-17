import { describe, expect, expectTypeOf, it } from 'vitest';

import { funnelDataSchema, type FunnelDataDto } from './funnel-response.js';
import type {
  FunnelDailyCounts,
  FunnelData,
  FunnelOptionalCounts,
  FunnelTotals,
  FunnelWindow,
} from '../../../application/commands/product-event.js';

/**
 * **形状镜像守卫** —— 应用层命令与 HTTP DTO 必须始终同形。
 *
 * ## 为什么会有两份定义
 *
 * `application/` 不得 import `adapters/`（`ddd-application-no-infra-or-adapters`）。
 * 但漏斗响应的形状天然属于 HTTP 契约（它有 zod schema、进 OpenAPI），
 * 而应用层又要类型来构造返回值。唯一既不违规也不开新口子的做法是
 * **各写一份**，再用测试钉住它们不漂移。
 *
 * 本文件因此放在 **adapters 侧**：它必须同时引用两侧类型，而
 * dapters → application 是允许的方向（反过来不行）。契约的归属方是 DTO，
 * 所以守卫也由它持有。
 *
 * ## 为什么必须**双向**断言
 *
 * `expectTypeOf<A>().toEqualTypeOf<B>()` 是双向的：任一侧多一个字段、少一个
 * 字段、或把某个字段改成可空，都会编译失败。
 *
 * 单方向的 `satisfies` 只能发现「应用层缺字段」——**发现不了「DTO 加了字段
 * 但应用层没跟上」**，而那恰好是最容易发生的漂移方向（后端加字段时先改
 * schema）。
 *
 * ## 失败时怎么办
 *
 * 不要改这条测试去迁就任何一侧。它红了意味着**契约真的变了**：
 * 要么同步改两侧，要么这是不兼容变更、需要走契约评审。
 */
describe('product-events 命令与 DTO 的形状镜像', () => {
  it('FunnelData 与漏斗响应 schema 双向同形', () => {
    expectTypeOf<FunnelData>().toEqualTypeOf<FunnelDataDto>();
  });

  it('FunnelDailyCounts / FunnelOptionalCounts / FunnelTotals / FunnelWindow 各自同形', () => {
    // 整体相等已经蕴含各子类型相等，但这些子类型在应用层是独立导出的，
    // 单独钉住能让失败信息直接指到出问题的那一层。
    expectTypeOf<FunnelDailyCounts>().toEqualTypeOf<
      FunnelDataDto['daily'][number]
    >();
    expectTypeOf<FunnelOptionalCounts>().toEqualTypeOf<
      FunnelDataDto['optional']
    >();
    expectTypeOf<FunnelTotals>().toEqualTypeOf<FunnelDataDto['totals']>();
    expectTypeOf<FunnelWindow>().toEqualTypeOf<FunnelDataDto['window']>();
  });

  it('一份完整样例能通过 schema 校验并赋给应用层类型', () => {
    // 运行时的一半：校验 schema 真的接受应用层能产出的形状。
    const sample = {
      daily: [
        {
          date: '2026-10-25',
          eventStarted: 5,
          suggestionImpression: 9,
          suggestionActioned: 3,
          eventEndedOrOutcome: 2,
          reviewOpened: 4,
        },
      ],
      optional: {
        visitSummaryPreviewed: 1,
        visitSummaryExported: 1,
        visitSummaryShareCreated: 0,
        visitSummaryShareOpened: 0,
      },
      totals: {
        eventStarted: 5,
        suggestionImpression: 9,
        suggestionActioned: 3,
        eventEndedOrOutcome: 2,
        reviewOpened: 4,
      },
      window: {
        dateFrom: '2026-10-25',
        dateTo: '2026-10-25',
        generatedAt: '2026-10-25T00:00:00.000Z',
        detailsSuppressed: true,
      },
    };

    const parsed: FunnelData = funnelDataSchema.parse(sample);
    expect(parsed.totals.eventStarted).toBe(5);
    expect(parsed.window.detailsSuppressed).toBe(true);
  });
});
