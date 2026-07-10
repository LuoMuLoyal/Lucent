import request from 'supertest';

import { ResultCode } from '../../../src/common/api';
import type { ApiEnvelope } from '../../../src/common/api';
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

    const createBody = createRes.body as ApiEnvelope<{
      id: string;
      currentMedicineId: string;
      label: string;
      scheduledHour: number;
      scheduledMinute: number;
      daysOfWeek: number[];
      note: string;
    }>;
    expect(createBody.code).toBe(ResultCode.SUCCESS);
    expect(createBody.data!.currentMedicineId).toBe(medicine.id);
    expect(createBody.data!.label).toBe('Morning dose');
    expect(createBody.data!.daysOfWeek).toEqual([1, 3, 5]);
    expect(createBody.data!.note).toBe('After breakfast');

    const listRes = await request(app.getHttpServer())
      .get(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listBody = listRes.body as ApiEnvelope<{ items: any[] }>;
    expect(listBody.code).toBe(ResultCode.SUCCESS);
    expect(listBody.data!.items).toHaveLength(1);
    expect(listBody.data!.items[0].id).toBe(createBody.data!.id);
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

    const body = createRes.body as ApiEnvelope<{ daysOfWeek: number[] | null }>;
    expect(body.data!.daysOfWeek).toBeNull();
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

    const body = listRes.body as ApiEnvelope<{ items: any[] }>;
    expect(body.data!.items).toHaveLength(1);
    expect(body.data!.items[0].label).toBe('Active');
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

    const id = (createRes.body as ApiEnvelope<{ id: string }>).data!.id;

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

    const body = updateRes.body as ApiEnvelope<{
      currentMedicineId: string | null;
      label: string;
      scheduledHour: number;
      scheduledMinute: number;
      daysOfWeek: number[] | null;
    }>;
    expect(body.data!.currentMedicineId).toBeNull();
    expect(body.data!.label).toBe('Evening dose');
    expect(body.data!.scheduledHour).toBe(20);
    expect(body.data!.scheduledMinute).toBe(5);
    expect(body.data!.daysOfWeek).toBeNull();
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

    const id = (createRes.body as ApiEnvelope<{ id: string }>).data!.id;

    await request(app.getHttpServer())
      .delete(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const body = listRes.body as ApiEnvelope<{ items: any[] }>;
    expect(body.data!.items).toHaveLength(0);

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

    const id = (createRes.body as ApiEnvelope<{ id: string }>).data!.id;

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

      const body = res.body as ApiEnvelope<{ items: unknown[] }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      expect(body.data!.items).toEqual([]);
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

      const body = res.body as ApiEnvelope<{
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
      }>;

      expect(body.code).toBe(ResultCode.SUCCESS);
      expect(body.data!.items).toHaveLength(1);

      const delivery = body.data!.items[0]!;
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

      const body = res.body as ApiEnvelope<{ items: unknown[] }>;
      expect(body.data!.items).toHaveLength(1);
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

      const body = res.body as ApiEnvelope<{ items: unknown[] }>;
      expect(body.data!.items).toHaveLength(2);
    });
  });
});
