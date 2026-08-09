import { SuggestionCacheInvalidationListener } from './suggestion-cache-invalidation.listener';

describe('SuggestionCacheInvalidationListener', () => {
  let listener: SuggestionCacheInvalidationListener;
  let cache: {
    invalidateSignals: vi.Mock;
    invalidateSuggestions: vi.Mock;
    invalidateBaseline: vi.Mock;
  };
  let prisma: {
    user: { findUnique: vi.Mock };
  };
  let recomputeQueue: { enqueue: vi.Mock };

  beforeEach(() => {
    cache = {
      invalidateSignals: vi.fn().mockResolvedValue(undefined),
      invalidateSuggestions: vi.fn().mockResolvedValue(undefined),
      invalidateBaseline: vi.fn().mockResolvedValue(undefined),
    };
    prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          profile: { timezone: 'Asia/Shanghai' },
        }),
      },
    };
    recomputeQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    listener = new SuggestionCacheInvalidationListener(
      cache as never,
      prisma as never,
    );
    Object.defineProperty(listener, 'recomputeQueue', {
      configurable: true,
      value: recomputeQueue,
    });
  });

  describe('handleDailyRecordChanged', () => {
    it('should invalidate signals for the given user and date', async () => {
      await listener.handleDailyRecordChanged({
        userId: 'user-1',
        date: '2026-07-17',
      });

      expect(cache.invalidateSignals).toHaveBeenCalledWith(
        'user-1',
        '2026-07-17',
      );
    });

    it('should not throw when cache invalidation fails', async () => {
      cache.invalidateSignals.mockRejectedValue(new Error('cache error'));

      await listener.handleDailyRecordChanged({
        userId: 'user-1',
        date: '2026-07-17',
      });

      // Should resolve without throwing
      expect(cache.invalidateSignals).toHaveBeenCalled();
    });
  });

  describe('handleDoseLogChanged', () => {
    it('should invalidate signals for the given user and date', async () => {
      await listener.handleDoseLogChanged({
        userId: 'user-2',
        date: '2026-07-16',
      });

      expect(cache.invalidateSignals).toHaveBeenCalledWith(
        'user-2',
        '2026-07-16',
      );
    });

    it('should not throw when cache invalidation fails', async () => {
      cache.invalidateSignals.mockRejectedValue(new Error('cache error'));

      await listener.handleDoseLogChanged({
        userId: 'user-2',
        date: '2026-07-16',
      });

      expect(cache.invalidateSignals).toHaveBeenCalled();
    });
  });

  describe('handleReminderChanged', () => {
    it('should invalidate signals for today and baseline for the user', async () => {
      await listener.handleReminderChanged({ userId: 'user-3' });

      expect(cache.invalidateSignals).toHaveBeenCalledWith(
        'user-3',
        expect.any(String), // today's date in the user's timezone
      );
      expect(cache.invalidateBaseline).toHaveBeenCalledWith('user-3');
    });

    it('should use the user profile timezone when resolving today', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-08-01T18:00:00.000Z'));
        prisma.user.findUnique.mockResolvedValue({
          profile: { timezone: 'Asia/Shanghai' },
        });

        await listener.handleReminderChanged({ userId: 'user-3' });

        // 2026-08-01T18:00Z is 2026-08-02 02:00 in Asia/Shanghai.
        expect(cache.invalidateSignals).toHaveBeenCalledWith(
          'user-3',
          '2026-08-02',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not throw when cache invalidation fails', async () => {
      cache.invalidateSignals.mockRejectedValue(new Error('cache error'));

      await listener.handleReminderChanged({ userId: 'user-3' });

      expect(cache.invalidateSignals).toHaveBeenCalled();
    });
  });

  it('red: domain events enqueue one bounded recompute per user and date', async () => {
    const recomputeQueue = {
      enqueue: vi.fn(
        ({ userId, date }: { userId: string; date: string }) =>
          `${userId}:${date}`,
      ),
    };
    Object.defineProperty(listener, 'recomputeQueue', {
      configurable: true,
      value: recomputeQueue,
    });

    const payload = { userId: 'user-1', date: '2026-07-17' };
    await listener.handleDailyRecordChanged(payload);
    await listener.handleDailyRecordChanged(payload);

    expect(recomputeQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: payload.userId,
        date: payload.date,
      }),
    );
    expect(recomputeQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  describe('handleHealthContextChanged', () => {
    it('should invalidate signals for today and baseline for the user', async () => {
      await listener.handleHealthContextChanged({ userId: 'user-4' });

      expect(cache.invalidateSignals).toHaveBeenCalledWith(
        'user-4',
        expect.any(String),
      );
      expect(cache.invalidateBaseline).toHaveBeenCalledWith('user-4');
    });

    it('should not throw when cache invalidation fails', async () => {
      cache.invalidateBaseline.mockRejectedValue(new Error('cache error'));

      await listener.handleHealthContextChanged({ userId: 'user-4' });

      expect(cache.invalidateSignals).toHaveBeenCalled();
      expect(cache.invalidateBaseline).toHaveBeenCalled();
    });
  });

  describe('handleSettingsChanged', () => {
    it('should invalidate signals for today and baseline for the user', async () => {
      await listener.handleSettingsChanged({ userId: 'user-5' });

      expect(cache.invalidateSignals).toHaveBeenCalledWith(
        'user-5',
        expect.any(String),
      );
      expect(cache.invalidateBaseline).toHaveBeenCalledWith('user-5');
    });

    it('should not throw when cache invalidation fails', async () => {
      cache.invalidateSignals.mockRejectedValue(new Error('cache error'));

      await listener.handleSettingsChanged({ userId: 'user-5' });

      expect(cache.invalidateSignals).toHaveBeenCalled();
    });
  });
});
