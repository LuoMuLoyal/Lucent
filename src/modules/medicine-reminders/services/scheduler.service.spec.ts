import { ReminderSchedulerService } from './scheduler.service';
import type { NotificationsService } from '../../notifications';
import type { PushDeliveryService } from '../../notifications';
import type { PrismaService } from '../../../prisma';
import type { Cache } from 'cache-manager';
import type { I18nService } from 'nestjs-i18n';

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
      profile: { timezone: null, locale: null },
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
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
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
    // 未配置语义：errorMessage 固定为 push_not_configured（区别于真失败）
    sendToUser: vi.fn().mockResolvedValue({
      sent: false,
      errorMessage: 'push_not_configured',
    }),
  };
}

/** 简易内存缓存 fake：缺失视为未命中（undefined → 'unconfirmed'）。 */
function buildCache() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn((key: string) => Promise.resolve(store.get(key))),
    set: vi.fn((key: string, value: string, _ttl?: number) => {
      store.set(key, value);
      return Promise.resolve(value);
    }),
    del: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
}

/** i18n fake：仅实现调度器用到的两个 key，按 lang 返回中/英文案。 */
function buildI18n() {
  const t = vi.fn(
    (
      key: string,
      options?: { lang?: string; args?: Record<string, string> },
    ): string => {
      const lang = options?.lang ?? 'en';
      const args = options?.args ?? {};
      if (key === 'medicine-reminders.reminder_fallback_label') {
        return lang === 'en' ? 'Medication reminder' : '用药提醒';
      }
      if (key === 'medicine-reminders.reminder_due_content') {
        const label = args['label'] ?? '';
        return lang === 'en'
          ? `Time to take your medicine: ${label}`
          : `该吃药了：${label}`;
      }
      return key;
    },
  );
  return { t };
}

describe('ReminderSchedulerService', () => {
  let service: ReminderSchedulerService;
  let prisma: ReturnType<typeof buildPrisma>;
  let notifications: ReturnType<typeof buildNotifications>;
  let pushDelivery: ReturnType<typeof buildPushDelivery>;
  let cache: ReturnType<typeof buildCache>;
  let i18n: ReturnType<typeof buildI18n>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_TIME);

    prisma = buildPrisma();
    notifications = buildNotifications();
    pushDelivery = buildPushDelivery();
    cache = buildCache();
    i18n = buildI18n();

    service = new ReminderSchedulerService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      pushDelivery as unknown as PushDeliveryService,
      cache as unknown as Cache,
      i18n as unknown as I18nService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 收集写入的 push 审计行（channel='push' 的 createMany 调用）。 */
  function pushWrites(): Array<{ data: Record<string, unknown> }> {
    return prisma.userReminderDelivery.createMany.mock.calls
      .map((call) => call[0] as { data: Record<string, unknown> })
      .filter((args) => args.data['channel'] === 'push');
  }

  // ── No-op cases ──────────────────────────────────────────────────

  it('does nothing when no active reminders exist', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([]);

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.findFirst).not.toHaveBeenCalled();
    expect(prisma.userReminderDelivery.createMany).not.toHaveBeenCalled();
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

  it('creates an in_app delivery record and sends a notification for a due reminder', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ label: 'Breakfast dose' }),
    ]);

    await service.dispatchDueReminders();

    // 站内去重检查按 in_app 通道过滤
    expect(prisma.userReminderDelivery.findFirst).toHaveBeenCalledWith({
      where: {
        reminderId: 'reminder-1',
        scheduledFor: new Date('2026-07-20T00:30:00.000Z'),
        channel: 'in_app',
      },
      select: { id: true },
    });

    // in_app 审计行写入
    expect(prisma.userReminderDelivery.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        reminderId: 'reminder-1',
        channel: 'in_app',
        status: 'delivered',
        scheduledFor: new Date('2026-07-20T00:30:00.000Z'),
      }),
      skipDuplicates: true,
    });

    // 通知发送
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

  // ── i18n ────────────────────────────────────────────────────────

  it('localizes reminder copy to English when profile locale is en', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({
        label: 'Morning dose',
        user: { profile: { timezone: null, locale: 'en' } },
      }),
    ]);

    await service.dispatchDueReminders();

    expect(i18n.t).toHaveBeenCalledWith(
      'medicine-reminders.reminder_fallback_label',
      { lang: 'en' },
    );
    expect(i18n.t).toHaveBeenCalledWith(
      'medicine-reminders.reminder_due_content',
      { lang: 'en', args: { label: 'Morning dose' } },
    );
    expect(notifications.createOrReplaceScoped).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        title: 'Morning dose',
        content: 'Time to take your medicine: Morning dose',
      }),
      expect.anything(),
    );
  });

  it('falls back to zh-CN when profile locale is null', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({
        label: null,
        user: { profile: { timezone: null, locale: null } },
      }),
    ]);

    await service.dispatchDueReminders();

    expect(i18n.t).toHaveBeenCalledWith(
      'medicine-reminders.reminder_fallback_label',
      { lang: 'zh-CN' },
    );
    expect(i18n.t).toHaveBeenCalledWith(
      'medicine-reminders.reminder_due_content',
      { lang: 'zh-CN', args: { label: '用药提醒' } },
    );
    expect(notifications.createOrReplaceScoped).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        title: '用药提醒',
        content: '该吃药了：用药提醒',
      }),
      expect.anything(),
    );
  });

  it('passes the reminder label as the interpolation arg', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ label: 'Breakfast dose' }),
    ]);

    await service.dispatchDueReminders();

    expect(i18n.t).toHaveBeenCalledWith(
      'medicine-reminders.reminder_due_content',
      { lang: 'zh-CN', args: { label: 'Breakfast dose' } },
    );
  });

  // ── Deduplication ───────────────────────────────────────────────

  it('skips dispatch when an in_app delivery record already exists', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow(),
    ]);
    prisma.userReminderDelivery.findFirst.mockResolvedValue({
      id: 'existing-delivery',
    });

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.createMany).not.toHaveBeenCalled();
    expect(notifications.createOrReplaceScoped).not.toHaveBeenCalled();
    expect(pushDelivery.sendToUser).not.toHaveBeenCalled();
  });

  // ── Multiple reminders ──────────────────────────────────────────

  it('dispatches multiple due reminders in a single tick', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ id: 'r1', userId: 'u1', label: 'Morning' }),
      buildReminderRow({ id: 'r2', userId: 'u2', label: 'Evening' }),
    ]);

    await service.dispatchDueReminders();

    // 每个提醒 = 1 条 in_app + 1 条 push（能力 unconfirmed 且未配置→failed）
    expect(prisma.userReminderDelivery.createMany).toHaveBeenCalledTimes(4);
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

    expect(prisma.userReminderDelivery.createMany).toHaveBeenCalledTimes(2);
    expect(notifications.createOrReplaceScoped).toHaveBeenCalledTimes(1);
  });

  // ── Error handling ───────────────────────────────────────────────

  it('logs and returns when the database query fails', async () => {
    prisma.userMedicineReminder.findMany.mockRejectedValue(
      new Error('connection refused'),
    );

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.findFirst).not.toHaveBeenCalled();
    expect(prisma.userReminderDelivery.createMany).not.toHaveBeenCalled();
  });

  it('logs and continues when a single dispatch fails', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ id: 'r-fail' }),
      buildReminderRow({ id: 'r-ok' }),
    ]);
    // First notification send fails, second succeeds — the first reminder
    // should be skipped (no delivery record) and the second should dispatch.
    notifications.createOrReplaceScoped
      .mockRejectedValueOnce(new Error('notify conflict'))
      .mockResolvedValueOnce({} as never);

    await service.dispatchDueReminders();

    // 只有第二个提醒写记录：1 条 in_app + 1 条 push
    expect(prisma.userReminderDelivery.createMany).toHaveBeenCalledTimes(2);
    expect(notifications.createOrReplaceScoped).toHaveBeenCalledTimes(2);
  });

  // ── daysOfWeek edge cases ───────────────────────────────────────

  it('fires every day when daysOfWeek is null', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ daysOfWeek: null }),
    ]);

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.createMany).toHaveBeenCalledTimes(2);
  });

  it('fires when daysOfWeek includes the current weekday', async () => {
    // 2026-07-20 is Monday (weekday=1)
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow({ daysOfWeek: [1, 3, 5] }),
    ]);

    await service.dispatchDueReminders();

    expect(prisma.userReminderDelivery.createMany).toHaveBeenCalledTimes(2);
  });

  // ── Local capability gating ─────────────────────────────────────

  it('skips push entirely when local capability is active', async () => {
    cache.store.set('reminder:local-capability:user-1', 'active');
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow(),
    ]);

    await service.dispatchDueReminders();

    expect(cache.get).toHaveBeenCalledWith('reminder:local-capability:user-1');
    expect(pushDelivery.sendToUser).not.toHaveBeenCalled();
    expect(pushWrites()).toHaveLength(0);
  });

  it('skips push entirely when local capability is disabled', async () => {
    cache.store.set('reminder:local-capability:user-1', 'disabled');
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow(),
    ]);

    await service.dispatchDueReminders();

    expect(pushDelivery.sendToUser).not.toHaveBeenCalled();
    expect(pushWrites()).toHaveLength(0);
  });

  it('sends push when local capability is unconfirmed (cache miss)', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow(),
    ]);
    pushDelivery.sendToUser.mockResolvedValue({ sent: true });

    await service.dispatchDueReminders();

    expect(pushDelivery.sendToUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        title: 'Morning dose',
        body: '该吃药了：Morning dose',
        data: { reminderId: 'reminder-1', action: 'medicine_reminder' },
      }),
    );
  });

  it('sends push when local capability is unavailable', async () => {
    cache.store.set('reminder:local-capability:user-1', 'unavailable');
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow(),
    ]);
    pushDelivery.sendToUser.mockResolvedValue({ sent: true });

    await service.dispatchDueReminders();

    expect(pushDelivery.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('continues with push when the capability cache read fails', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow(),
    ]);
    cache.get.mockRejectedValue(new Error('redis down'));
    pushDelivery.sendToUser.mockResolvedValue({ sent: true });

    await service.dispatchDueReminders();

    // 缓存异常不中断 dispatch：按 unconfirmed 继续发 push
    expect(cache.get).toHaveBeenCalledWith('reminder:local-capability:user-1');
    expect(pushDelivery.sendToUser).toHaveBeenCalledTimes(1);
    expect(pushWrites()).toHaveLength(1);
    expect(prisma.userReminderDelivery.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'push',
        status: 'delivered',
      }),
      skipDuplicates: true,
    });
  });

  // ── Local delivery row skips push ────────────────────────────────

  it('skips push when a local delivery row already exists', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow(),
    ]);
    // 第一次 findFirst（in_app 去重）→ null；第二次（local 行）→ 已存在
    prisma.userReminderDelivery.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'local-delivery' });

    await service.dispatchDueReminders();

    expect(pushDelivery.sendToUser).not.toHaveBeenCalled();
    expect(pushWrites()).toHaveLength(0);
  });

  it('checks the local delivery row with a channel filter', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow(),
    ]);

    await service.dispatchDueReminders();

    // 第一次 findFirst：in_app 去重（channel='in_app'）
    expect(prisma.userReminderDelivery.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        reminderId: 'reminder-1',
        scheduledFor: new Date('2026-07-20T00:30:00.000Z'),
        channel: 'in_app',
      },
      select: { id: true },
    });
    // 第二次 findFirst：local 行检查（channel='local'）
    expect(prisma.userReminderDelivery.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        reminderId: 'reminder-1',
        scheduledFor: new Date('2026-07-20T00:30:00.000Z'),
        channel: 'local',
      },
      select: { id: true },
    });
  });

  // ── Push result rows ─────────────────────────────────────────────

  it('writes a delivered push row when push succeeds', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow(),
    ]);
    pushDelivery.sendToUser.mockResolvedValue({ sent: true });

    await service.dispatchDueReminders();

    expect(pushWrites()).toHaveLength(1);
    expect(prisma.userReminderDelivery.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        reminderId: 'reminder-1',
        channel: 'push',
        status: 'delivered',
        scheduledFor: new Date('2026-07-20T00:30:00.000Z'),
        deliveredAt: expect.any(Date),
      }),
      skipDuplicates: true,
    });
  });

  it('writes a failed push row with error message when push fails', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow(),
    ]);
    pushDelivery.sendToUser.mockResolvedValue({
      sent: false,
      errorMessage: 'JPush unavailable',
    });

    await service.dispatchDueReminders();

    expect(pushWrites()).toHaveLength(1);
    expect(prisma.userReminderDelivery.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        reminderId: 'reminder-1',
        channel: 'push',
        status: 'failed',
        scheduledFor: new Date('2026-07-20T00:30:00.000Z'),
        errorMessage: 'JPush unavailable',
      }),
      skipDuplicates: true,
    });
  });

  it('writes a failed push row with push_not_configured when push is not configured', async () => {
    prisma.userMedicineReminder.findMany.mockResolvedValue([
      buildReminderRow(),
    ]);
    // 默认 mock 返回未配置语义 { sent: false, errorMessage: 'push_not_configured' }

    await service.dispatchDueReminders();

    expect(pushWrites()).toHaveLength(1);
    expect(prisma.userReminderDelivery.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'push',
        status: 'failed',
        errorMessage: 'push_not_configured',
      }),
      skipDuplicates: true,
    });
  });
});
