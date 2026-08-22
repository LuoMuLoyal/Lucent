import request from 'supertest';

import {
  createTestApp,
  cleanupDatabase,
  createAccessToken,
  bearer,
  uniqueEmail,
} from '../../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers';
import { MedicineSource, UserStatus } from '#generated/prisma/client';

const BASE_PATH = '/api/v1/user/medicine-reminders';
const DELIVERIES_PATH = '/api/v1/user/reminder-deliveries';
const AUTH_HEADER = 'Authorization';

describe('Medicine Reminders API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  async function createUserWithToken() {
    const email = uniqueEmail('reminder');
    const user = await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });
    const token = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      user.id,
      user.email!,
    );
    return { user, token };
  }

  async function createCurrentMedicine(
    userId: string,
    displayName = 'Metformin',
  ) {
    return ctx.prisma.userCurrentMedicine.create({
      data: {
        userId,
        source: MedicineSource.manual,
        displayName,
        doseText: '1 tablet',
      },
    });
  }

  it('should create and list linked reminders', async () => {
    const { user, token } = await createUserWithToken();
    const medicine = await createCurrentMedicine(user.id);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: medicine.id,
        label: ' Morning dose ',
        scheduledHour: 8,
        scheduledMinute: 30,
        daysOfWeek: [5, 1, 3, 1],
        note: ' After breakfast ',
      })
      .expect(201);

    const createBody = createRes.body as {
      id: string;
      currentMedicineId: string;
      label: string;
      scheduledHour: number;
      scheduledMinute: number;
      daysOfWeek: number[];
      note: string;
    };
    expect(createBody!.currentMedicineId).toBe(medicine.id);
    expect(createBody!.label).toBe('Morning dose');
    expect(createBody!.daysOfWeek).toEqual([1, 3, 5]);
    expect(createBody!.note).toBe('After breakfast');

    const listRes = await request(app.getHttpServer())
      .get(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listBody = listRes.body as { items: any[] };
    expect(listBody!.items).toHaveLength(1);
    expect(listBody!.items[0].id).toBe(createBody!.id);
  });

  it('should treat null weekdays as every day', async () => {
    const { token } = await createUserWithToken();

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        scheduledHour: 21,
        scheduledMinute: 0,
        daysOfWeek: null,
      })
      .expect(201);

    const body = createRes.body as { daysOfWeek: number[] | null };
    expect(body!.daysOfWeek).toBeNull();
  });

  it('should honor activeOnly query', async () => {
    const { token } = await createUserWithToken();

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        label: 'Active',
        scheduledHour: 8,
        scheduledMinute: 0,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        label: 'Paused',
        scheduledHour: 9,
        scheduledMinute: 0,
        isActive: false,
      })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get(`${BASE_PATH}?activeOnly=true`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const body = listRes.body as { items: any[] };
    expect(body!.items).toHaveLength(1);
    expect(body!.items[0].label).toBe('Active');
  });

  it('should reject reminders linked to another user medicine', async () => {
    const { token } = await createUserWithToken();
    const { user: otherUser } = await createUserWithToken();
    const otherMedicine = await createCurrentMedicine(otherUser.id);

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: otherMedicine.id,
        scheduledHour: 8,
        scheduledMinute: 0,
      })
      .expect(404);
  });

  it('should update and unlink a reminder', async () => {
    const { user, token } = await createUserWithToken();
    const medicine = await createCurrentMedicine(user.id);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: medicine.id,
        scheduledHour: 8,
        scheduledMinute: 30,
      })
      .expect(201);

    const id = (createRes.body as { id: string }).id;

    const updateRes = await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: null,
        label: 'Evening dose',
        scheduledHour: 20,
        scheduledMinute: 5,
        daysOfWeek: null,
      })
      .expect(200);

    const body = updateRes.body as {
      currentMedicineId: string | null;
      label: string;
      scheduledHour: number;
      scheduledMinute: number;
      daysOfWeek: number[] | null;
    };
    expect(body!.currentMedicineId).toBeNull();
    expect(body!.label).toBe('Evening dose');
    expect(body!.scheduledHour).toBe(20);
    expect(body!.scheduledMinute).toBe(5);
    expect(body!.daysOfWeek).toBeNull();
  });

  it('should soft-delete reminders', async () => {
    const { token } = await createUserWithToken();

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        scheduledHour: 8,
        scheduledMinute: 0,
      })
      .expect(201);

    const id = (createRes.body as { id: string }).id;

    await request(app.getHttpServer())
      .delete(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const body = listRes.body as { items: any[] };
    expect(body!.items).toHaveLength(0);

    const stored = await ctx.prisma.userMedicineReminder.findUniqueOrThrow({
      where: { id },
    });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.isActive).toBe(false);
  });

  it('should return 404 for foreign reminder updates', async () => {
    const { token } = await createUserWithToken();
    const { token: otherToken } = await createUserWithToken();

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        scheduledHour: 8,
        scheduledMinute: 0,
      })
      .expect(201);

    const id = (createRes.body as { id: string }).id;

    await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(otherToken))
      .send({ scheduledHour: 10 })
      .expect(404);
  });

  it('should reject invalid schedule values', async () => {
    const { token } = await createUserWithToken();

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        scheduledHour: 24,
        scheduledMinute: 0,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        scheduledHour: 8,
        scheduledMinute: 60,
      })
      .expect(400);
  });

  it('should require auth for reminder access', async () => {
    await request(app.getHttpServer()).get(BASE_PATH).expect(401);
  });

  // ── Group upsert ────────────────────────────────────────────

  describe('PUT /api/v1/user/medicine-reminders/group', () => {
    it('should create a new group with two slots', async () => {
      const { user, token } = await createUserWithToken();
      const medicine = await createCurrentMedicine(user.id);

      const res = await request(app.getHttpServer())
        .put(`${BASE_PATH}/group`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          currentMedicineId: medicine.id,
          label: 'Metformin',
          daysOfWeek: [1, 2, 3],
          slots: [
            { scheduledHour: 8, scheduledMinute: 30 },
            { scheduledHour: 20, scheduledMinute: 5 },
          ],
        })
        .expect(200);

      const body = res.body as { items: any[] };
      expect(body!.items).toHaveLength(2);
      expect(
        body!.items.every((i) => i.currentMedicineId === medicine.id),
      ).toBe(true);
    });

    it('should update, add, and soft-delete removed slots', async () => {
      const { user, token } = await createUserWithToken();
      const medicine = await createCurrentMedicine(user.id);

      const first = await request(app.getHttpServer())
        .put(`${BASE_PATH}/group`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          currentMedicineId: medicine.id,
          slots: [
            { scheduledHour: 8, scheduledMinute: 0 },
            { scheduledHour: 12, scheduledMinute: 0 },
          ],
        })
        .expect(200);

      const firstBody = first.body as { items: any[] };
      const keptId = firstBody!.items[0]!.id;
      const removedId = firstBody!.items[1]!.id;

      const second = await request(app.getHttpServer())
        .put(`${BASE_PATH}/group`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          currentMedicineId: medicine.id,
          slots: [
            { id: keptId, scheduledHour: 9, scheduledMinute: 15 },
            { scheduledHour: 21, scheduledMinute: 45 },
          ],
        })
        .expect(200);

      const secondBody = second.body as { items: any[] };
      expect(secondBody!.items).toHaveLength(2);

      const kept = secondBody!.items.find((i) => i.id === keptId);
      expect(kept!.scheduledHour).toBe(9);
      expect(kept!.scheduledMinute).toBe(15);

      const removed = await ctx.prisma.userMedicineReminder.findUniqueOrThrow({
        where: { id: removedId },
      });
      expect(removed.deletedAt).not.toBeNull();
      expect(removed.isActive).toBe(false);
    });

    it('should return 404 when a slot id belongs to another user', async () => {
      const { user, token } = await createUserWithToken();
      const medicine = await createCurrentMedicine(user.id);
      const { user: otherUser } = await createUserWithToken();
      const otherMedicine = await createCurrentMedicine(otherUser.id);

      const foreign = await ctx.prisma.userMedicineReminder.create({
        data: {
          userId: otherUser.id,
          currentMedicineId: otherMedicine.id,
          scheduledHour: 8,
          scheduledMinute: 0,
        },
      });

      await request(app.getHttpServer())
        .put(`${BASE_PATH}/group`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          currentMedicineId: medicine.id,
          slots: [{ id: foreign.id, scheduledHour: 8, scheduledMinute: 0 }],
        })
        .expect(404);
    });

    it('should reject invalid slot hour/minute', async () => {
      const { user, token } = await createUserWithToken();
      const medicine = await createCurrentMedicine(user.id);

      await request(app.getHttpServer())
        .put(`${BASE_PATH}/group`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          currentMedicineId: medicine.id,
          slots: [{ scheduledHour: 24, scheduledMinute: 0 }],
        })
        .expect(400);

      await request(app.getHttpServer())
        .put(`${BASE_PATH}/group`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          currentMedicineId: medicine.id,
          slots: [{ scheduledHour: 8, scheduledMinute: 60 }],
        })
        .expect(400);
    });

    it('should be idempotent when submitting the same slots again', async () => {
      const { user, token } = await createUserWithToken();
      const medicine = await createCurrentMedicine(user.id);

      const first = await request(app.getHttpServer())
        .put(`${BASE_PATH}/group`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          currentMedicineId: medicine.id,
          slots: [
            { scheduledHour: 8, scheduledMinute: 0 },
            { scheduledHour: 20, scheduledMinute: 0 },
          ],
        })
        .expect(200);

      const firstBody = first.body as {
        items: Array<{
          id: string;
          scheduledHour: number;
          scheduledMinute: number;
        }>;
      };
      const firstIds = firstBody!.items.map((i) => i.id).sort();

      const second = await request(app.getHttpServer())
        .put(`${BASE_PATH}/group`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          currentMedicineId: medicine.id,
          slots: firstBody!.items.map((i) => ({
            id: i.id,
            scheduledHour: i.scheduledHour,
            scheduledMinute: i.scheduledMinute,
          })),
        })
        .expect(200);

      const secondBody = second.body as {
        items: Array<{ id: string }>;
      };
      expect(secondBody!.items.map((i) => i.id).sort()).toEqual(firstIds);
      expect(secondBody!.items).toHaveLength(2);

      const rows = await ctx.prisma.userMedicineReminder.findMany({
        where: { userId: user.id, currentMedicineId: medicine.id },
      });
      const activeRows = rows.filter((r) => r.deletedAt === null);
      expect(activeRows).toHaveLength(2);
    });
  });

  // ── Reminder Deliveries ────────────────────────────────────

  describe('GET /api/v1/user/reminder-deliveries', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).get(DELIVERIES_PATH).expect(401);
    });

    it('should return empty delivery list for a new user', async () => {
      const { token } = await createUserWithToken();

      const res = await request(app.getHttpServer())
        .get(DELIVERIES_PATH)
        .set(AUTH_HEADER, bearer(token))
        .expect(200);

      const body = res.body as { items: unknown[] };
      expect(body!.items).toEqual([]);
    });

    it('should list delivery audit logs for the authenticated user', async () => {
      const { user, token } = await createUserWithToken();

      // Seed a reminder and a delivery log
      const medicine = await createCurrentMedicine(user.id);
      const reminder = await ctx.prisma.userMedicineReminder.create({
        data: {
          userId: user.id,
          currentMedicineId: medicine.id,
          label: 'Morning dose',
          scheduledHour: 8,
          scheduledMinute: 30,
        },
      });

      const scheduledFor = new Date('2026-07-10T08:00:00.000Z');
      const deliveredAt = new Date('2026-07-10T08:00:05.000Z');

      await ctx.prisma.userReminderDelivery.create({
        data: {
          userId: user.id,
          reminderId: reminder.id,
          deviceId: 'device-1',
          channel: 'local',
          status: 'delivered',
          scheduledFor,
          deliveredAt,
        },
      });

      const res = await request(app.getHttpServer())
        .get(DELIVERIES_PATH)
        .set(AUTH_HEADER, bearer(token))
        .expect(200);

      const body = res.body as {
        items: Array<{
          id: string;
          reminderId: string | null;
          deviceId: string | null;
          channel: string;
          status: string;
          scheduledFor: string;
          deliveredAt: string | null;
          errorMessage: string | null;
          createdAt: string;
        }>;
      };

      expect(body!.items).toHaveLength(1);

      const delivery = body!.items[0]!;
      expect(delivery.reminderId).toBe(reminder.id);
      expect(delivery.deviceId).toBe('device-1');
      expect(delivery.channel).toBe('local');
      expect(delivery.status).toBe('delivered');
      expect(delivery.scheduledFor).toBeTruthy();
      expect(delivery.deliveredAt).toBeTruthy();
    });

    it('should filter deliveries by date', async () => {
      const { user, token } = await createUserWithToken();

      const scheduledFor1 = new Date('2026-07-10T08:00:00.000Z');
      const scheduledFor2 = new Date('2026-07-11T08:00:00.000Z');

      await ctx.prisma.userReminderDelivery.createMany({
        data: [
          {
            userId: user.id,
            channel: 'local',
            status: 'delivered',
            scheduledFor: scheduledFor1,
            deliveredAt: scheduledFor1,
          },
          {
            userId: user.id,
            channel: 'local',
            status: 'scheduled',
            scheduledFor: scheduledFor2,
          },
        ],
      });

      const res = await request(app.getHttpServer())
        .get(`${DELIVERIES_PATH}?date=2026-07-10`)
        .set(AUTH_HEADER, bearer(token))
        .expect(200);

      const body = res.body as { items: unknown[] };
      expect(body!.items).toHaveLength(1);
    });

    it('should respect limit parameter', async () => {
      const { user, token } = await createUserWithToken();

      const baseDate = new Date('2026-07-10T08:00:00.000Z');
      await ctx.prisma.userReminderDelivery.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          userId: user.id,
          channel: 'local',
          status: 'delivered',
          scheduledFor: new Date(baseDate.getTime() + i * 60_000),
          deliveredAt: new Date(baseDate.getTime() + i * 60_000),
        })),
      });

      const res = await request(app.getHttpServer())
        .get(`${DELIVERIES_PATH}?limit=2`)
        .set(AUTH_HEADER, bearer(token))
        .expect(200);

      const body = res.body as { items: unknown[] };
      expect(body!.items).toHaveLength(2);
    });
  });

  // ── Reminder delivery write endpoints ───────────────────────────

  describe('reminder delivery write endpoints', () => {
    it('should require auth for receipts and capability endpoints', async () => {
      await request(app.getHttpServer())
        .post(`${DELIVERIES_PATH}/receipts`)
        .send({
          reminderId: 'x',
          scheduledDate: '2026-07-10',
          scheduledTime: '08:00',
        })
        .expect(401);
      await request(app.getHttpServer())
        .put(`${DELIVERIES_PATH}/local-capability`)
        .send({ state: 'active' })
        .expect(401);
    });

    it('should record a local delivery receipt idempotently', async () => {
      const { user, token } = await createUserWithToken();
      const medicine = await createCurrentMedicine(user.id);
      const reminder = await ctx.prisma.userMedicineReminder.create({
        data: {
          userId: user.id,
          currentMedicineId: medicine.id,
          label: 'Morning dose',
          scheduledHour: 8,
          scheduledMinute: 0,
        },
      });

      const body = {
        reminderId: reminder.id,
        scheduledDate: '2026-07-10',
        scheduledTime: '08:00',
      };

      // Asia/Shanghai 08:00 → UTC 2026-07-10T00:00:00.000Z
      const res = await request(app.getHttpServer())
        .post(`${DELIVERIES_PATH}/receipts`)
        .set(AUTH_HEADER, bearer(token))
        .send(body)
        .expect(201);

      const created = res.body as {
        item: {
          id: string;
          channel: string;
          status: string;
          scheduledFor: string;
        };
      };
      expect(created!.item.channel).toBe('local');
      expect(created!.item.status).toBe('delivered');
      expect(created!.item.scheduledFor).toBe('2026-07-10T00:00:00.000Z');

      // 幂等：重复上报返回同一行，不新增
      const again = await request(app.getHttpServer())
        .post(`${DELIVERIES_PATH}/receipts`)
        .set(AUTH_HEADER, bearer(token))
        .send(body)
        .expect(201);

      const second = again.body as { item: { id: string } };
      expect(second!.item.id).toBe(created!.item.id);

      const rows = await ctx.prisma.userReminderDelivery.findMany({
        where: { userId: user.id, channel: 'local' },
      });
      expect(rows).toHaveLength(1);
    });

    it('should respect the profile timezone when recording a receipt', async () => {
      const { user, token } = await createUserWithToken();
      await ctx.prisma.userProfile.create({
        data: { userId: user.id, timezone: 'America/New_York' },
      });
      const medicine = await createCurrentMedicine(user.id);
      const reminder = await ctx.prisma.userMedicineReminder.create({
        data: {
          userId: user.id,
          currentMedicineId: medicine.id,
          scheduledHour: 8,
          scheduledMinute: 0,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`${DELIVERIES_PATH}/receipts`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          reminderId: reminder.id,
          scheduledDate: '2026-07-10',
          scheduledTime: '08:00',
        })
        .expect(201);

      const body = res.body as { item: { scheduledFor: string } };
      // America/New_York（7月 UTC-4）08:00 → UTC 12:00
      expect(body!.item.scheduledFor).toBe('2026-07-10T12:00:00.000Z');
    });

    it('should return 404 when the receipt targets a foreign reminder', async () => {
      const { token } = await createUserWithToken();
      const { user: otherUser } = await createUserWithToken();
      const medicine = await createCurrentMedicine(otherUser.id);
      const foreignReminder = await ctx.prisma.userMedicineReminder.create({
        data: {
          userId: otherUser.id,
          currentMedicineId: medicine.id,
          scheduledHour: 8,
          scheduledMinute: 0,
        },
      });

      await request(app.getHttpServer())
        .post(`${DELIVERIES_PATH}/receipts`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          reminderId: foreignReminder.id,
          scheduledDate: '2026-07-10',
          scheduledTime: '08:00',
        })
        .expect(404);
    });

    it('should reject a receipt with an invalid scheduledTime', async () => {
      const { user, token } = await createUserWithToken();
      const medicine = await createCurrentMedicine(user.id);
      const reminder = await ctx.prisma.userMedicineReminder.create({
        data: {
          userId: user.id,
          currentMedicineId: medicine.id,
          scheduledHour: 8,
          scheduledMinute: 0,
        },
      });

      await request(app.getHttpServer())
        .post(`${DELIVERIES_PATH}/receipts`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          reminderId: reminder.id,
          scheduledDate: '2026-07-10',
          scheduledTime: '25:00',
        })
        .expect(400);
    });

    it('should reject a receipt with an invalid scheduledDate', async () => {
      const { user, token } = await createUserWithToken();
      const medicine = await createCurrentMedicine(user.id);
      const reminder = await ctx.prisma.userMedicineReminder.create({
        data: {
          userId: user.id,
          currentMedicineId: medicine.id,
          scheduledHour: 8,
          scheduledMinute: 0,
        },
      });

      // 完整 ISO 时间戳能通过 IsDateString 但会让 wallClockToScheduledFor
      // 得到 NaN → 500；仅接受 YYYY-MM-DD，非法输入直接 400。
      await request(app.getHttpServer())
        .post(`${DELIVERIES_PATH}/receipts`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          reminderId: reminder.id,
          scheduledDate: '2026-07-10T08:00:00.000Z',
          scheduledTime: '08:00',
        })
        .expect(400);
    });

    it('should report and persist local capability', async () => {
      const { token } = await createUserWithToken();

      const res = await request(app.getHttpServer())
        .put(`${DELIVERIES_PATH}/local-capability`)
        .set(AUTH_HEADER, bearer(token))
        .send({ state: 'active' })
        .expect(200);

      const body = res.body as { state: string };
      expect(body!.state).toBe('active');
    });

    it('should reject an invalid local capability state', async () => {
      const { token } = await createUserWithToken();

      await request(app.getHttpServer())
        .put(`${DELIVERIES_PATH}/local-capability`)
        .set(AUTH_HEADER, bearer(token))
        .send({ state: 'maybe' })
        .expect(400);
    });
  });
});
