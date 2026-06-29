/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any */

import request from 'supertest';

import { ResultCode } from '../../../src/common/api-envelope';
import type { ApiEnvelope } from '../../../src/common/api-envelope';
import {
  createTestApp,
  cleanupDatabase,
  createAccessToken,
  bearer,
  uniqueEmail,
} from '../../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers';
import {
  MedicineSource,
  UserStatus,
} from '../../../src/generated/prisma/client';

const BASE_PATH = '/api/v1/user/medicine-reminders';
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
});
