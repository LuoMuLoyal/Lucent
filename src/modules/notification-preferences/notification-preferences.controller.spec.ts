import { ResultCode } from '../../common';
import { NotificationPreferencesController } from './notification-preferences.controller';

describe('NotificationPreferencesController', () => {
  it('returns the authenticated user preferences in the GET envelope', async () => {
    const preferences = {
      healthAlertsEnabled: true,
      weeklyInsightEnabled: false,
      waterRemindersEnabled: true,
      sleepReminderEnabled: false,
      sleepBedtimeMinutes: null,
      sleepWakeTimeMinutes: null,
      configured: false,
      updatedAt: null,
    };
    const service = {
      get: vi.fn().mockResolvedValue(preferences),
      patch: vi.fn(),
    };
    const controller = new NotificationPreferencesController(service as never);

    await expect(
      controller.get({ sub: 'user-1', email: 'a@b.c', status: 'active' }),
    ).resolves.toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: preferences,
    });
    expect(service.get).toHaveBeenCalledWith('user-1');
  });

  it('partially updates preferences in the PATCH envelope', async () => {
    const preferences = {
      healthAlertsEnabled: false,
      weeklyInsightEnabled: false,
      waterRemindersEnabled: true,
      sleepReminderEnabled: false,
      sleepBedtimeMinutes: null,
      sleepWakeTimeMinutes: null,
      configured: true,
      updatedAt: '2026-08-20T01:02:03.000Z',
    };
    const service = {
      get: vi.fn(),
      patch: vi.fn().mockResolvedValue(preferences),
    };
    const controller = new NotificationPreferencesController(service as never);

    await expect(
      controller.patch(
        { sub: 'user-1', email: 'a@b.c', status: 'active' },
        { healthAlertsEnabled: false },
      ),
    ).resolves.toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: preferences,
    });
    expect(service.patch).toHaveBeenCalledWith('user-1', {
      healthAlertsEnabled: false,
    });
  });
});
