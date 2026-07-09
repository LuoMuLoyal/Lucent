import { LifecycleService } from './lifecycle.service';
import { SuggestionLifecycleState } from '../../types';

describe('LifecycleService', () => {
  let service: LifecycleService;
  let findManyMock: jest.Mock;
  let countMock: jest.Mock;

  beforeEach(() => {
    findManyMock = jest.fn();
    countMock = jest.fn();

    const prismaMock = {
      userSuggestion: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findMany: findManyMock,
        count: countMock,
      },
    };

    service = new LifecycleService(prismaMock as never);
  });

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

      await service.getHistory('user-1', '2026-07-01', '2026-07-09', {
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

      await service.getHistory('user-1', '2026-07-01', '2026-07-09');

      const findManyCall = findManyMock.mock.calls[0]![0];
      expect(findManyCall.take).toBe(100);
    });

    it('should cap limit at 500', async () => {
      findManyMock.mockResolvedValue([]);
      countMock.mockResolvedValue(0);

      await service.getHistory('user-1', '2026-07-01', '2026-07-09', {
        limit: 1000,
      });

      const findManyCall = findManyMock.mock.calls[0]![0];
      expect(findManyCall.take).toBe(500);
    });
  });

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
});
