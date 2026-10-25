import { LifecycleService } from './lifecycle.js';
import { SuggestionLifecycleState } from '../domain/suggestion/suggestion.types.js';
import type { SuggestionCandidate } from '../domain/suggestion/suggestion-candidate.js';
import { formatDateOnly, now } from '../../../common/index.js';

function createMockCache() {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
  } as never;
}

describe('LifecycleService', () => {
  let service: LifecycleService;
  let findManyMock: vi.Mock;
  let countMock: vi.Mock;
  let createMock: vi.Mock;
  let updateManyMock: vi.Mock;
  let readModelMock: { getActiveSuggestions: vi.Mock };
  let historyReadModelMock: { getHistory: vi.Mock };

  beforeEach(() => {
    readModelMock = { getActiveSuggestions: vi.fn() };
    historyReadModelMock = { getHistory: vi.fn() };
    findManyMock = vi.fn();
    countMock = vi.fn();
    createMock = vi.fn();
    updateManyMock = vi.fn();

    const prismaMock = {
      userSuggestion: {
        create: createMock,
        updateMany: updateManyMock,
        findMany: findManyMock,
        count: countMock,
      },
    };

    service = new LifecycleService(
      prismaMock as never,
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
      createMock.mockResolvedValue({ id: 'sug-123' });

      const id = await service.persistActive(
        'user-1',
        baseCandidate,
        '2026-07-10',
        baseCopy,
        'zh-CN',
      );

      expect(id).toBe('sug-123');
      expect(createMock).toHaveBeenCalledTimes(1);
      const call = createMock.mock.calls[0]![0];
      expect(call.data.userId).toBe('user-1');
      expect(call.data.date).toBe('2026-07-10');
      expect(call.data.type).toBe('behavior_advice');
      expect(call.data.lifecycleState).toBe(SuggestionLifecycleState.ACTIVE);
      expect(call.data.ruleId).toBe('water_behind_target');
      expect(call.data.locale).toBe('zh-CN');
      expect(call.data.generatedAt).toBeDefined();
      expect(call.data.activatedAt).toBeDefined();
    });

    it('persists the recompute source version on the active card', async () => {
      createMock.mockResolvedValue({ id: 'sug-versioned' });

      await service.persistActive(
        'user-1',
        baseCandidate,
        '2026-07-10',
        baseCopy,
        'zh-CN',
        7,
      );

      expect(createMock.mock.calls[0]![0].data.sourceVersion).toBe(7);
    });

    it('includes secondaryActions when provided', async () => {
      createMock.mockResolvedValue({ id: 'sug-456' });
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

      const call = createMock.mock.calls[0]![0];
      expect(call.data.secondaryActions).toEqual([
        {
          actionId: 'snooze',
          label: '稍后提醒',
          route: '/today',
          authRequired: true,
        },
      ]);
    });

    it('omits secondaryActions when undefined', async () => {
      createMock.mockResolvedValue({ id: 'sug-789' });

      await service.persistActive(
        'user-1',
        baseCandidate,
        '2026-07-10',
        baseCopy,
        'zh-CN',
      );

      const call = createMock.mock.calls[0]![0];
      expect(call.data.secondaryActions).toBeUndefined();
    });

    it('includes subtype when provided', async () => {
      createMock.mockResolvedValue({ id: 'sug-sub' });
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

      const call = createMock.mock.calls[0]![0];
      expect(call.data.subtype).toBe('water');
    });

    it('omits subtype when undefined', async () => {
      createMock.mockResolvedValue({ id: 'sug-nosub' });

      await service.persistActive(
        'user-1',
        baseCandidate,
        '2026-07-10',
        baseCopy,
        'zh-CN',
      );

      const call = createMock.mock.calls[0]![0];
      expect(call.data.subtype).toBeUndefined();
    });
  });

  // ── expireStaleSuggestions ─────────────────────────────────────────────

  describe('expireStaleSuggestions', () => {
    it('expires active suggestions and returns count', async () => {
      updateManyMock.mockResolvedValue({ count: 3 });

      const count = await service.expireStaleSuggestions(
        'user-1',
        '2026-07-10',
      );

      expect(count).toBe(3);
      const call = updateManyMock.mock.calls[0]![0];
      expect(call.where.userId).toBe('user-1');
      expect(call.where.date).toBe('2026-07-10');
      expect(call.where.lifecycleState).toBe(SuggestionLifecycleState.ACTIVE);
      expect(call.data.lifecycleState).toBe(SuggestionLifecycleState.EXPIRED);
      expect(call.data.expiredAt).toBeDefined();
    });

    it('returns 0 when no suggestions to expire', async () => {
      updateManyMock.mockResolvedValue({ count: 0 });

      const count = await service.expireStaleSuggestions(
        'user-1',
        '2026-07-10',
      );

      expect(count).toBe(0);
    });

    it('does not expire cards written by a newer source version', async () => {
      updateManyMock.mockResolvedValue({ count: 1 });

      await service.expireStaleSuggestions('user-1', '2026-07-10', 7);

      expect(updateManyMock.mock.calls[0]![0].where.sourceVersion).toEqual({
        lte: 7,
      });
    });
  });

  // ── dismissSuggestion ──────────────────────────────────────────────────

  describe('dismissSuggestion', () => {
    it('updates suggestion lifecycle to dismissed', async () => {
      updateManyMock.mockResolvedValue({ count: 1 });

      await service.dismissSuggestion('user-1', 'sug-123');

      const call = updateManyMock.mock.calls[0]![0];
      expect(call.where.id).toBe('sug-123');
      expect(call.where.userId).toBe('user-1');
      expect(call.where.lifecycleState).toBe(SuggestionLifecycleState.ACTIVE);
      expect(call.data.lifecycleState).toBe(SuggestionLifecycleState.DISMISSED);
    });

    it('silently handles when suggestion is not in ACTIVE state', async () => {
      // If the suggestion was already dismissed/expired, updateMany returns 0
      updateManyMock.mockResolvedValue({ count: 0 });

      await service.dismissSuggestion('user-1', 'sug-123');

      expect(updateManyMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── getActiveSuggestionIds ─────────────────────────────────────────────

  describe('getActiveSuggestionIds', () => {
    it('returns a Set of ruleId:subtype composite keys', async () => {
      findManyMock.mockResolvedValue([
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
      findManyMock.mockResolvedValue([]);

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
      // First updateMany call: ACTIVE → FADING
      // Second updateMany call: FADING → EXPIRED
      updateManyMock
        .mockResolvedValueOnce({ count: 5 }) // ACTIVE → FADING
        .mockResolvedValueOnce({ count: 2 }); // FADING → EXPIRED

      await service.refreshLifecycleStates();

      expect(updateManyMock).toHaveBeenCalledTimes(2);

      const fadingCall = updateManyMock.mock.calls[0]![0];
      expect(fadingCall.where.lifecycleState).toBe(
        SuggestionLifecycleState.ACTIVE,
      );
      expect(fadingCall.data.lifecycleState).toBe(
        SuggestionLifecycleState.FADING,
      );
      expect(fadingCall.data.fadingAt).toBeDefined();
      expect(fadingCall.where.activatedAt).toBeDefined();
      expect(fadingCall.where.activatedAt.lt).toBeDefined();

      const expiredCall = updateManyMock.mock.calls[1]![0];
      expect(expiredCall.where.lifecycleState).toBe(
        SuggestionLifecycleState.FADING,
      );
      expect(expiredCall.data.lifecycleState).toBe(
        SuggestionLifecycleState.EXPIRED,
      );
      expect(expiredCall.data.expiredAt).toBeDefined();
      expect(expiredCall.where.activatedAt).toBeDefined();
      expect(expiredCall.where.activatedAt.lt).toBeDefined();
    });

    it('completes silently when no transitions occur', async () => {
      updateManyMock
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 });

      await service.refreshLifecycleStates();

      expect(updateManyMock).toHaveBeenCalledTimes(2);
    });
  });
});
