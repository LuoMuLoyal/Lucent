import { LifecycleService } from './service';
import { SuggestionLifecycleState } from '../../types/suggestion.types';
import type { SuggestionCandidate } from '../../types/candidate.types';

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

  beforeEach(() => {
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

    service = new LifecycleService(prismaMock as never, createMockCache());
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

  // ── getHistory ──────────────────────────────────────────────────────────

  describe('getHistory', () => {
    it('should return mapped history items with total count', async () => {
      const mockRecords = [
        {
          id: 'sug-1',
          date: '2026-07-09',
          type: 'behavior_advice',
          title: '今日饮水还差 6 杯',
          reason: '今日已记录 2 杯，目标 8 杯。',
          ruleId: 'water_behind_target',
          ruleVersion: '1.0.0',
          triggerType: 'timer',
          lifecycleState: SuggestionLifecycleState.EXPIRED,
          confidence: 'medium',
          subtype: 'water',
          feedback: 'accepted',
          feedbackAt: new Date('2026-07-09T10:00:00.000Z'),
          generatedAt: new Date('2026-07-09T08:00:00.000Z'),
          expiredAt: new Date('2026-07-09T23:59:59.000Z'),
        },
        {
          id: 'sug-2',
          date: '2026-07-08',
          type: 'compliance',
          title: 'Test Medicine 尚未服药',
          reason: '已超过计划服药时间 60 分钟。',
          ruleId: 'missed_dose_pending',
          ruleVersion: '1.0.0',
          triggerType: 'event',
          lifecycleState: SuggestionLifecycleState.DISMISSED,
          confidence: 'high',
          subtype: null,
          feedback: 'later',
          feedbackAt: new Date('2026-07-08T12:00:00.000Z'),
          generatedAt: new Date('2026-07-08T08:30:00.000Z'),
          expiredAt: null,
        },
      ];

      findManyMock.mockResolvedValue(mockRecords);
      countMock.mockResolvedValue(2);

      const result = await service.getHistory(
        'user-1',
        '2026-07-01',
        '2026-07-09',
        'zh-CN',
      );

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);

      const first = result.items[0]!;
      expect(first.id).toBe('sug-1');
      expect(first.date).toBe('2026-07-09');
      expect(first.type).toBe('behavior_advice');
      expect(first.lifecycleState).toBe(SuggestionLifecycleState.EXPIRED);
      expect(first.subtype).toBe('water');
      expect(first.feedback).toBe('accepted');
      expect(first.generatedAt).toBe('2026-07-09T08:00:00.000Z');
      expect(first.expiredAt).toBe('2026-07-09T23:59:59.000Z');

      const second = result.items[1]!;
      expect(second.id).toBe('sug-2');
      expect(second.subtype).toBeUndefined();
      expect(second.feedback).toBe('later');
      expect(second.expiredAt).toBeUndefined();
    });

    it('should pass filters to prisma query', async () => {
      findManyMock.mockResolvedValue([]);
      countMock.mockResolvedValue(0);

      await service.getHistory('user-1', '2026-07-01', '2026-07-09', 'zh-CN', {
        lifecycleState: 'expired',
        type: 'behavior_advice',
        limit: 50,
      });

      const findManyCall = findManyMock.mock.calls[0]![0];
      expect(findManyCall.where.lifecycleState).toBe('expired');
      expect(findManyCall.where.type).toBe('behavior_advice');
      expect(findManyCall.take).toBe(50);

      const countCall = countMock.mock.calls[0]![0];
      expect(countCall.where.lifecycleState).toBe('expired');
      expect(countCall.where.type).toBe('behavior_advice');
    });

    it('should apply default limit of 100 when no limit provided', async () => {
      findManyMock.mockResolvedValue([]);
      countMock.mockResolvedValue(0);

      await service.getHistory('user-1', '2026-07-01', '2026-07-09', 'zh-CN');

      const findManyCall = findManyMock.mock.calls[0]![0];
      expect(findManyCall.take).toBe(100);
    });

    it('should cap limit at 500', async () => {
      findManyMock.mockResolvedValue([]);
      countMock.mockResolvedValue(0);

      await service.getHistory('user-1', '2026-07-01', '2026-07-09', 'zh-CN', {
        limit: 1000,
      });

      const findManyCall = findManyMock.mock.calls[0]![0];
      expect(findManyCall.take).toBe(500);
    });
  });

  // ── getDefaultStartDate ────────────────────────────────────────────────

  describe('getDefaultStartDate', () => {
    it('should return a date string 30 days ago', () => {
      const startDate = LifecycleService.getDefaultStartDate();
      expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const today = new Date();
      const expected = new Date();
      expected.setUTCDate(today.getUTCDate() - 30);
      expect(startDate).toBe(expected.toISOString().slice(0, 10));
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
