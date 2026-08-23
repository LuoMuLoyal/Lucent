import { NotificationPreferencesService } from './notification-preferences.service';

async function unwrapOk<T>(
  result: ReturnType<NotificationPreferencesService['patch']>,
): Promise<T> {
  const outcome = await result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  if (!outcome.ok) {
    throw new Error(`Expected ok result, got ${outcome.error.code}`);
  }
  return outcome.value as T;
}

describe('NotificationPreferencesService', () => {
  it('returns default values and configured=false when the row is missing', async () => {
    const prisma = {
      userNotificationPreference: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new NotificationPreferencesService(prisma as never);

    await expect(service.get('user-1')).resolves.toEqual({
      healthAlertsEnabled: true,
      weeklyInsightEnabled: false,
      waterRemindersEnabled: true,
      sleepReminderEnabled: false,
      sleepBedtimeMinutes: null,
      sleepWakeTimeMinutes: null,
      configured: false,
      updatedAt: null,
    });
  });

  it('patches only supplied fields and returns the configured row', async () => {
    const updatedAt = new Date('2026-08-20T01:02:03.000Z');
    const prisma = {
      userNotificationPreference: {
        findUnique: vi.fn(),
        upsert: vi.fn().mockResolvedValue({
          healthAlertsEnabled: false,
          weeklyInsightEnabled: true,
          waterRemindersEnabled: true,
          sleepReminderEnabled: false,
          sleepBedtimeMinutes: 1380,
          sleepWakeTimeMinutes: null,
          updatedAt,
        }),
      },
    };
    const service = new NotificationPreferencesService(prisma as never);

    await expect(
      unwrapOk(
        service.patch('user-1', {
          healthAlertsEnabled: false,
          weeklyInsightEnabled: true,
          sleepBedtimeMinutes: 1380,
        }),
      ),
    ).resolves.toEqual({
      healthAlertsEnabled: false,
      weeklyInsightEnabled: true,
      waterRemindersEnabled: true,
      sleepReminderEnabled: false,
      sleepBedtimeMinutes: 1380,
      sleepWakeTimeMinutes: null,
      configured: true,
      updatedAt: updatedAt.toISOString(),
    });

    expect(prisma.userNotificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        update: {
          healthAlertsEnabled: false,
          weeklyInsightEnabled: true,
          sleepBedtimeMinutes: 1380,
        },
      }),
    );
  });

  it.each([-1, 1440])(
    'rejects sleep time minute %s outside 0..1439 with VALIDATION_FAILED',
    async (minutes) => {
      const prisma = {
        userNotificationPreference: { upsert: vi.fn() },
      };
      const service = new NotificationPreferencesService(prisma as never);

      const outcome = await service
        .patch('user-1', { sleepBedtimeMinutes: minutes })
        .match(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error }),
        );

      expect(outcome).toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
      expect(prisma.userNotificationPreference.upsert).not.toHaveBeenCalled();
    },
  );

  it('returns the current row without writing when the payload is empty', async () => {
    const prisma = {
      userNotificationPreference: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    };
    const service = new NotificationPreferencesService(prisma as never);

    await expect(unwrapOk(service.patch('user-1', {}))).resolves.toMatchObject({
      configured: false,
    });
    expect(prisma.userNotificationPreference.upsert).not.toHaveBeenCalled();
  });

  it.each(['sleep_shortfall', 'event_check_in_trend', 'deteriorating_symptom'])(
    'maps %s to healthAlertsEnabled',
    async (ruleId) => {
      const prisma = {
        userNotificationPreference: {
          findUnique: vi.fn().mockResolvedValue({
            ...{
              healthAlertsEnabled: false,
              weeklyInsightEnabled: false,
              waterRemindersEnabled: true,
              sleepReminderEnabled: false,
              sleepBedtimeMinutes: null,
              sleepWakeTimeMinutes: null,
              updatedAt: new Date('2026-08-20T00:00:00.000Z'),
            },
          }),
        },
      };
      const service = new NotificationPreferencesService(prisma as never);

      await expect(service.isRuleEnabled('user-1', ruleId)).resolves.toBe(
        false,
      );
    },
  );

  it('maps water_behind_target only to waterRemindersEnabled', async () => {
    const prisma = {
      userNotificationPreference: {
        findUnique: vi.fn().mockResolvedValue({
          healthAlertsEnabled: false,
          weeklyInsightEnabled: false,
          waterRemindersEnabled: true,
          sleepReminderEnabled: false,
          sleepBedtimeMinutes: null,
          sleepWakeTimeMinutes: null,
          updatedAt: new Date('2026-08-20T00:00:00.000Z'),
        }),
      },
    };
    const service = new NotificationPreferencesService(prisma as never);

    await expect(
      service.isRuleEnabled('user-1', 'water_behind_target'),
    ).resolves.toBe(true);
  });

  it('does not gate missed_dose_pending with notification preferences', async () => {
    const prisma = {
      userNotificationPreference: { findUnique: vi.fn() },
    };
    const service = new NotificationPreferencesService(prisma as never);

    await expect(
      service.isRuleEnabled('user-1', 'missed_dose_pending'),
    ).resolves.toBe(true);
    expect(prisma.userNotificationPreference.findUnique).not.toHaveBeenCalled();
  });

  it('fails closed when a gated-rule preference read fails', async () => {
    const prisma = {
      userNotificationPreference: {
        findUnique: vi
          .fn()
          .mockRejectedValue(new Error('database unavailable')),
      },
    };
    const service = new NotificationPreferencesService(prisma as never);

    await expect(
      service.isRuleEnabled('user-1', 'sleep_shortfall'),
    ).resolves.toBe(false);
    await expect(
      service.isRuleEnabled('user-1', 'water_behind_target'),
    ).resolves.toBe(false);
  });
});
