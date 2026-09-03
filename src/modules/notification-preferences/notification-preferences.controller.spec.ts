import { NotificationPreferencesController } from './notification-preferences.controller.js';
import {
  createDomainFailure,
  errAsync,
  okAsync,
} from '../../common/result/index.js';

describe('NotificationPreferencesController', () => {
  it('returns the authenticated user preferences resource', async () => {
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
    ).resolves.toEqual(preferences);
    expect(service.get).toHaveBeenCalledWith('user-1');
  });

  it('partially updates preferences and returns the resource', async () => {
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
      patch: vi.fn().mockReturnValue(okAsync(preferences)),
    };
    const controller = new NotificationPreferencesController(service as never);

    await expect(
      controller.patch(
        { sub: 'user-1', email: 'a@b.c', status: 'active' },
        { healthAlertsEnabled: false },
      ),
    ).resolves.toEqual(preferences);
    expect(service.patch).toHaveBeenCalledWith('user-1', {
      healthAlertsEnabled: false,
    });
  });

  it('folds a patch validation failure into DomainFailureException (400)', async () => {
    const service = {
      get: vi.fn(),
      patch: vi.fn().mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'validation',
            code: 'VALIDATION_FAILED',
          }),
        ),
      ),
    };
    const controller = new NotificationPreferencesController(service as never);

    await expect(
      controller.patch(
        { sub: 'user-1', email: 'a@b.c', status: 'active' },
        { sleepBedtimeMinutes: 9999 },
      ),
    ).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: { code: 'VALIDATION_FAILED' },
    });
  });
});
