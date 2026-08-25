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
    listener = new SuggestionCacheInvalidationListener(
      cache as never,
      prisma as never,
    );
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

    it('upgrades to error log after consecutive failures exceed threshold', async () => {
      cache.invalidateSignals.mockRejectedValue(new Error('cache error'));
      const logger = (
        listener as unknown as { logger: { warn: vi.Mock; error: vi.Mock } }
      ).logger;
      const warnSpy = vi.spyOn(logger, 'warn');
      const errorSpy = vi.spyOn(logger, 'error');

      // First two failures: warn level
      await listener.handleDailyRecordChanged({
        userId: 'user-1',
        date: '2026-07-17',
      });
      await listener.handleDailyRecordChanged({
        userId: 'user-1',
        date: '2026-07-17',
      });
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy).not.toHaveBeenCalled();

      // Third failure: error level
      await listener.handleDailyRecordChanged({
        userId: 'user-1',
        date: '2026-07-17',
      });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('consecutive=3');
    });

    it('resets failure counter on success', async () => {
      const logger = (
        listener as unknown as { logger: { warn: vi.Mock; error: vi.Mock } }
      ).logger;
      const errorSpy = vi.spyOn(logger, 'error');

      // Two failures then a success then two more failures
      cache.invalidateSignals.mockRejectedValueOnce(new Error('err'));
      cache.invalidateSignals.mockRejectedValueOnce(new Error('err'));
      cache.invalidateSignals.mockResolvedValueOnce(undefined);
      cache.invalidateSignals.mockRejectedValueOnce(new Error('err'));
      cache.invalidateSignals.mockRejectedValueOnce(new Error('err'));

      for (let i = 0; i < 5; i += 1) {
        await listener.handleDailyRecordChanged({
          userId: 'user-1',
          date: '2026-07-17',
        });
      }

      // Counter reset on success, so the 5th call (2nd consecutive failure
      // after reset) should still be warn, not error.
      expect(errorSpy).not.toHaveBeenCalled();
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

  describe('handleHealthEventChanged', () => {
    it('invalidates signals and result cache for the changed date', async () => {
      await listener.handleHealthEventChanged({
        userId: 'user-6',
        eventId: 'event-1',
        date: '2026-07-17',
        change: 'check-in',
      });

      expect(cache.invalidateSignals).toHaveBeenCalledWith(
        'user-6',
        '2026-07-17',
      );
    });
  });
});
