import { ReminderSchedulerService } from './scheduler.service';
import type { NotificationsService } from '../../notifications/services/notifications.service';
import type { PushDeliveryService } from '../../notifications/services/push-delivery.service';
import type { PrismaService } from '../../../prisma/prisma.service';

// 2026-07-20T00:30:00.000Z = 08:30 Monday in Asia/Shanghai
const TEST_TIME = new Date('2026-07-20T00:30:00.000Z');

function buildReminderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reminder-1',
    userId: 'user-1',
    label: 'Morning dose',
    scheduledHour: 8,
    scheduledMinute: 30,
    daysOfWeek: null,
    startDate: null,
    endDate: null,
    user: {
      profile: { timezone: null },
    },
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const reminderFindMany = vi.fn().mockResolvedValue([]);
  return {
    userMedicineReminder: {
      findMany: reminderFindMany,
    },
    nonDeleted: {
      userMedicineReminder: {
        findMany: reminderFindMany,
      },
    },
    userReminderDelivery: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

function buildNotifications() {
  return {
    createOrReplaceScoped: vi.fn().mockResolvedValue({}),
  };
}

function buildPushDelivery() {
  return {
    sendToUser: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ReminderSchedulerService', () => {
  let service: ReminderSchedulerService;
  let prisma: ReturnType<typeof buildPrisma>;
  let notifications: ReturnType<typeof buildNotifications>;
  let pushDelivery: ReturnType<typeof buildPushDelivery>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_TIME);

    prisma = buildPrisma();
    notifications = buildNotifications();
    pushDelivery = buildPushDelivery();

    service = new ReminderSchedulerService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      pushDelivery as unknown as PushDeliveryService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── No-op cases ──────────────────────────────────────────────────

  it('does nothing when no active reminders exist', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([]);

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.findFirst).not.toHaveBeenCalled();
    expect(prisma.userReminderDelivery.create).not.toHaveBeenCalled();
    expect(notifications.createOrReplaceScoped).not.toHaveBeenCalled();
  });

  it('skips reminders whose scheduledHour does not match', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ scheduledHour: 9, scheduledMinute: 30 }),
    ]);

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.findFirst).not.toHaveBeenCalled();
  });

  it('skips reminders whose scheduledMinute does not match', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ scheduledHour: 8, scheduledMinute: 31 }),
    ]);

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.findFirst).not.toHaveBeenCalled();
  });

  it('skips reminders whose daysOfWeek does not include the current weekday', async () => {
    // 2026-07-20 is a Monday (weekday=1); set days to Sunday only
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ daysOfWeek: [0] }),
    ]);

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.findFirst).not.toHaveBeenCalled();
  });

  it('skips reminders whose startDate is in the future', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ startDate: new Date('2026-07-21') }),
    ]);

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.findFirst).not.toHaveBeenCalled();
  });

  it('skips reminders whose endDate is in the past', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ endDate: new Date('2026-07-19') }),
    ]);

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.findFirst).not.toHaveBeenCalled();
  });

  // ── Happy path ───────────────────────────────────────────────────

  it('creates a delivery record and sends a notification for a due reminder', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ label: 'Breakfast dose' }),
    ]);

    await service.dispatchDueReminders();

    // Delivery dedup check
    expect(prisma.userReminderDelivery.findFirst).toHaveBeenCalledWith({
      where: {
        reminderId: 'reminder-1',
        scheduledFor: new Date('2026-07-20T00:30:00.000Z'),
      },
      select: { id: true },
    });

    // Delivery record created
    expect(prisma.userReminderDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        reminderId: 'reminder-1',
        channel: 'in_app',
        status: 'delivered',
        scheduledFor: new Date('2026-07-20T00:30:00.000Z'),
      }),
    });

    // Notification sent
    expect(notifications.createOrReplaceScoped).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        type: 'medicine_reminder',
        title: 'Breakfast dose',
        content: '该吃药了：Breakfast dose',
      }),
      expect.objectContaining({
        source: 'medicine_reminder_reminder-1',
      }),
    );
  });

  it('uses a default label when reminder label is null', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ label: null }),
    ]);

    await service.dispatchDueReminders();

    expect(notifications.createOrReplaceScoped).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        title: '用药提醒',
        content: '该吃药了：用药提醒',
      }),
      expect.anything(),
    );
  });

  // ── Deduplication ───────────────────────────────────────────────

  it('skips dispatch when a delivery record already exists', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow(),
    ]);
    prisma.userReminderDelivery.findFirst.mockResolvedValue({
      id: 'existing-delivery',
    });

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.create).not.toHaveBeenCalled();
    expect(notifications.createOrReplaceScoped).not.toHaveBeenCalled();
  });

  // ── Multiple reminders ──────────────────────────────────────────

  it('dispatches multiple due reminders in a single tick', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ id: 'r1', userId: 'u1', label: 'Morning' }),
      buildReminderRow({ id: 'r2', userId: 'u2', label: 'Evening' }),
    ]);

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.create).toHaveBeenCalledTimes(2);
    expect(notifications.createOrReplaceScoped).toHaveBeenCalledTimes(2);
  });

  // ── Timezone ─────────────────────────────────────────────────────

  it('respects user timezone for matching', async () => {
    // 2026-07-20T00:30:00Z = 20:30 previous day in America/New_York (UTC-4)
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({
        id: 'r-tz',
        userId: 'u-tz',
        scheduledHour: 20,
        scheduledMinute: 30,
        user: { profile: { timezone: 'America/New_York' } },
      }),
    ]);

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.create).toHaveBeenCalledTimes(1);
    expect(notifications.createOrReplaceScoped).toHaveBeenCalledTimes(1);
  });

  // ── Overlap protection ───────────────────────────────────────

  it('skips dispatch when a previous tick is still running', async () => {
    // Make findMany hang so the first dispatch doesn't complete
    let resolveFindMany: (value: unknown[]) => void = () => {};
    prisma.userMedicineReminder.findMany.mockReturnValue(
      new Promise((resolve) => {
        resolveFindMany = resolve;
      }),
    );

    // Start first dispatch (doesn't await)
    const first = service.dispatchDueReminders();

    // Try a second dispatch while the first is still pending
    await service.dispatchDueReminders();

    // The second dispatch should have returned without calling any dispatch logic.
    // Since findMany is mocked to hang, the only way the second dispatch returns
    // immediately is via the overlap guard.
    expect(prisma.userReminderDelivery.findFirst).not.toHaveBeenCalled();
    expect(prisma.userReminderDelivery.create).not.toHaveBeenCalled();

    // Allow the first dispatch to complete
    resolveFindMany([]);
    await first;
  });

  // ── Error handling ───────────────────────────────────────────────

  it('logs and returns when the database query fails', async () => {
    prisma.userMedicineReminder.findMany.mockRejectedValue(
      new Error('connection refused'),
    );

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.findFirst).not.toHaveBeenCalled();
    expect(prisma.userReminderDelivery.create).not.toHaveBeenCalled();
  });

  it('logs and continues when a single dispatch fails', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ id: 'r-fail' }),
      buildReminderRow({ id: 'r-ok' }),
    ]);
    // First delivery check succeeds, first create fails
    prisma.userReminderDelivery.create
      .mockRejectedValueOnce(new Error('write conflict'))
      .mockResolvedValueOnce({});

    await service.dispatchDueReminders();

    // Second reminder should still be dispatched
    expect(prisma.userReminderDelivery.create).toHaveBeenCalledTimes(2);
    expect(notifications.createOrReplaceScoped).toHaveBeenCalledTimes(1);
  });

  // ── daysOfWeek edge cases ───────────────────────────────────────

  it('fires every day when daysOfWeek is null', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ daysOfWeek: null }),
    ]);

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.create).toHaveBeenCalledTimes(1);
  });

  it('fires when daysOfWeek includes the current weekday', async () => {
    // 2026-07-20 is Monday (weekday=1)
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ daysOfWeek: [1, 3, 5] }),
    ]);

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.create).toHaveBeenCalledTimes(1);
  });
});
