import { LifecycleService } from './lifecycle.js';
import { formatDateOnly, now } from '../../../../common/index.js';
import type { SuggestionLifecycleStore } from '../ports/suggestion-lifecycle.js';
import type { SuggestionCandidate } from '../../domain/suggestion/suggestion-candidate.js';

function createMockCache() {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
  } as never;
}

describe('LifecycleService', () => {
  let service: LifecycleService;
  let createActiveMock: vi.Mock;
  let expireActiveMock: vi.Mock;
  let dismissActiveMock: vi.Mock;
  let listActiveCardKeysMock: vi.Mock;
  let fadeActiveBeforeMock: vi.Mock;
  let expireFadingBeforeMock: vi.Mock;
  let readModelMock: { getActiveSuggestions: vi.Mock };
  let historyReadModelMock: { getHistory: vi.Mock };

  beforeEach(() => {
    readModelMock = { getActiveSuggestions: vi.fn() };
    historyReadModelMock = { getHistory: vi.fn() };
    createActiveMock = vi.fn();
    expireActiveMock = vi.fn();
    dismissActiveMock = vi.fn();
    listActiveCardKeysMock = vi.fn();
    fadeActiveBeforeMock = vi.fn().mockResolvedValue(0);
    expireFadingBeforeMock = vi.fn().mockResolvedValue(0);

    // The store port replaced the direct Prisma dependency, so the double
    // satisfies the port. Assertions below moved from "did we build this Prisma
    // query" to "did we call the store with these arguments"; the query shape
    // itself belongs to the persistence implementation's own tests.
    const storeMock = {
      createActive: createActiveMock,
      expireActive: expireActiveMock,
      dismissActive: dismissActiveMock,
      listActiveCardKeys: listActiveCardKeysMock,
      fadeActiveBefore: fadeActiveBeforeMock,
      expireFadingBefore: expireFadingBeforeMock,
    };

    service = new LifecycleService(
      storeMock as unknown as SuggestionLifecycleStore,
      createMockCache(),
      readModelMock as never,
      historyReadModelMock as never,
    );
  });

  // ── persistActive ──────────────────────────────────────────────────────

  describe('persistActive', () => {
    const baseCandidate: SuggestionCandidate = {
      candidateId: 'cand-1',
      ruleId: 'water_behind_target',
      ruleVersion: '1.0.0',
      type: 'behavior_advice' as never,
      triggerType: 'timer' as never,
      evidence: [{ kind: 'record', label: 'water', value: '2 / 8 杯' }],
      primaryAction: {
        actionId: 'go_today',
        label: '去记录',
        route: '/today',
        authRequired: true,
      },
      priorityScore: 60,
      confidence: 'medium' as never,
      notificationEligible: true,
      copyGeneration: {
        templateKey: 'test.template',
        params: {},
      },
    };

    const baseCopy = {
      title: '今日饮水还差 6 杯',
      reason: '今日已记录 2 杯，目标 8 杯。',
      boundary: '仅在用户当日记录不足时展示。',
    };

    it('persists a candidate and returns the generated id', async () => {
      createActiveMock.mockResolvedValue('sug-123');

      const id = await service.persistActive(
        'user-1',
        baseCandidate,
        '2026-07-10',
        baseCopy,
        'zh-CN',
      );

      expect(id).toBe('sug-123');
      expect(createActiveMock).toHaveBeenCalledTimes(1);
      const call = createActiveMock.mock.calls[0]![0];
      expect(call.userId).toBe('user-1');
      expect(call.date).toBe('2026-07-10');
      expect(call.candidate.type).toBe('behavior_advice');
      expect(call.candidate.ruleId).toBe('water_behind_target');
      expect(call.locale).toBe('zh-CN');
      expect(call.generatedAt).toBeDefined();
    });

    it('persists the recompute source version on the active card', async () => {
      createActiveMock.mockResolvedValue('sug-versioned');

      await service.persistActive(
        'user-1',
        baseCandidate,
        '2026-07-10',
        baseCopy,
        'zh-CN',
        7,
      );

      expect(createActiveMock.mock.calls[0]![0].sourceVersion).toBe(7);
    });

    it('includes secondaryActions when provided', async () => {
      createActiveMock.mockResolvedValue('sug-456');
      const candidate: SuggestionCandidate = {
        ...baseCandidate,
        secondaryActions: [
          {
            actionId: 'snooze',
            label: '稍后提醒',
            route: '/today',
            authRequired: true,
          },
        ],
      };

      await service.persistActive(
        'user-1',
        candidate,
        '2026-07-10',
        baseCopy,
        'zh-CN',
      );

      const call = createActiveMock.mock.calls[0]![0];
      expect(call.candidate.secondaryActions).toEqual([
        {
          actionId: 'snooze',
          label: '稍后提醒',
          route: '/today',
          authRequired: true,
        },
      ]);
    });

    it('omits secondaryActions when undefined', async () => {
      createActiveMock.mockResolvedValue('sug-789');

      await service.persistActive(
        'user-1',
        baseCandidate,
        '2026-07-10',
        baseCopy,
        'zh-CN',
      );

      const call = createActiveMock.mock.calls[0]![0];
      expect(call.candidate.secondaryActions).toBeUndefined();
    });

    it('includes subtype when provided', async () => {
      createActiveMock.mockResolvedValue('sug-sub');
      const candidate: SuggestionCandidate = {
        ...baseCandidate,
        subtype: 'water',
      };

      await service.persistActive(
        'user-1',
        candidate,
        '2026-07-10',
        baseCopy,
        'zh-CN',
      );

      const call = createActiveMock.mock.calls[0]![0];
      expect(call.candidate.subtype).toBe('water');
    });

    it('omits subtype when undefined', async () => {
      createActiveMock.mockResolvedValue('sug-nosub');

      await service.persistActive(
        'user-1',
        baseCandidate,
        '2026-07-10',
        baseCopy,
        'zh-CN',
      );

      const call = createActiveMock.mock.calls[0]![0];
      expect(call.candidate.subtype).toBeUndefined();
    });
  });

  // ── expireStaleSuggestions ─────────────────────────────────────────────

  describe('expireStaleSuggestions', () => {
    it('expires active suggestions and returns count', async () => {
      expireActiveMock.mockResolvedValue(3);

      const count = await service.expireStaleSuggestions(
        'user-1',
        '2026-07-10',
      );

      expect(count).toBe(3);
      const call = expireActiveMock.mock.calls[0]!;
      expect(call[0]).toBe('user-1');
      expect(call[1]).toBe('2026-07-10');
      expect(call[2]).toBeDefined();
    });

    it('returns 0 when no suggestions to expire', async () => {
      expireActiveMock.mockResolvedValue(0);

      const count = await service.expireStaleSuggestions(
        'user-1',
        '2026-07-10',
      );

      expect(count).toBe(0);
    });

    it('does not expire cards written by a newer source version', async () => {
      expireActiveMock.mockResolvedValue(1);

      await service.expireStaleSuggestions('user-1', '2026-07-10', 7);

      expect(expireActiveMock.mock.calls[0]![3]).toBe(7);
    });
  });

  // ── dismissSuggestion ──────────────────────────────────────────────────

  describe('dismissSuggestion', () => {
    it('updates suggestion lifecycle to dismissed', async () => {
      expireActiveMock.mockResolvedValue(1);

      await service.dismissSuggestion('user-1', 'sug-123');

      expect(dismissActiveMock).toHaveBeenCalledWith('user-1', 'sug-123');
    });

    it('silently handles when suggestion is not in ACTIVE state', async () => {
      // If the card was already dismissed/expired the store updates 0 rows.
      dismissActiveMock.mockResolvedValue(undefined);

      await service.dismissSuggestion('user-1', 'sug-123');

      expect(dismissActiveMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── getActiveSuggestionIds ─────────────────────────────────────────────

  describe('getActiveSuggestionIds', () => {
    it('returns a Set of ruleId:subtype composite keys', async () => {
      listActiveCardKeysMock.mockResolvedValue([
        { ruleId: 'rule_a', subtype: 'water' },
        { ruleId: 'rule_b', subtype: null },
        { ruleId: 'rule_c', subtype: 'sleep' },
      ]);

      const ids = await service.getActiveSuggestionIds('user-1', '2026-07-10');

      expect(ids).toBeInstanceOf(Set);
      expect(ids.size).toBe(3);
      expect(ids.has('rule_a:water')).toBe(true);
      expect(ids.has('rule_b:')).toBe(true);
      expect(ids.has('rule_c:sleep')).toBe(true);
    });

    it('returns empty set when no active suggestions', async () => {
      listActiveCardKeysMock.mockResolvedValue([]);

      const ids = await service.getActiveSuggestionIds('user-1', '2026-07-10');

      expect(ids.size).toBe(0);
    });
  });

  // ── getDefaultStartDate ────────────────────────────────────────────────

  describe('getDefaultStartDate', () => {
    it('should return a date string 30 days ago', () => {
      const startDate = LifecycleService.getDefaultStartDate();
      expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const expected = now();
      expected.setDate(expected.getDate() - 30);
      expect(startDate).toBe(formatDateOnly(expected));
    });
  });

  // ── refreshLifecycleStates ─────────────────────────────────────────────

  describe('refreshLifecycleStates', () => {
    it('transitions ACTIVE→FADING and FADING→EXPIRED', async () => {
      fadeActiveBeforeMock.mockResolvedValue(5);
      expireFadingBeforeMock.mockResolvedValue(2);

      await service.refreshLifecycleStates();

      expect(fadeActiveBeforeMock).toHaveBeenCalledTimes(1);
      expect(expireFadingBeforeMock).toHaveBeenCalledTimes(1);

      // Thresholds now arrive as `Date`s computed by the domain rule rather
      // than a hand-built Prisma WHERE clause. Ordering is the real invariant:
      // the fade threshold must be *later* than the expiry threshold, or a card
      // could be expired before it was ever faded.
      const fadeThreshold = fadeActiveBeforeMock.mock.calls[0]![0] as Date;
      const expiryThreshold = expireFadingBeforeMock.mock.calls[0]![0] as Date;
      expect(fadeThreshold).toBeInstanceOf(Date);
      expect(expiryThreshold).toBeInstanceOf(Date);
      expect(fadeThreshold.getTime()).toBeGreaterThan(
        expiryThreshold.getTime(),
      );
    });

    it('completes silently when no transitions occur', async () => {
      fadeActiveBeforeMock.mockResolvedValue(0);
      expireFadingBeforeMock.mockResolvedValue(0);

      await service.refreshLifecycleStates();

      expect(fadeActiveBeforeMock).toHaveBeenCalledTimes(1);
      expect(expireFadingBeforeMock).toHaveBeenCalledTimes(1);
    });
  });
});
