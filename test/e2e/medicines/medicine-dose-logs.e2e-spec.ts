import request from 'supertest';

import { ResultCode } from '../../../src/common/api-envelope';
import type { ApiEnvelope } from '../../../src/common/api-envelope';
import {
  createTestApp,
  cleanupDatabase,
  createAccessToken,
  bearer,
  expectData,
  expectDefined,
  uniqueEmail,
} from '../../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers';
import { MedicineSource, UserStatus } from '#generated/prisma/client';

const BASE_PATH = '/api/v1/user/medicine-dose-logs';
const AUTH_HEADER = 'Authorization';

describe('Medicine Dose Logs API (e2e)', () => {
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
    const email = uniqueEmail('doselog');
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
      expectDefined(user.email, 'Expected user email'),
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

  it('should create and list linked dose logs', async () => {
    const { user, token } = await createUserWithToken();
    const medicine = await createCurrentMedicine(user.id);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: medicine.id,
        status: 'taken',
        scheduledFor: '2026-06-04',
        doseText: '1 tablet',
        note: 'with breakfast',
      })
      .expect(201);

    const createBody = createRes.body as ApiEnvelope<{
      id: string;
      currentMedicineId: string;
      status: string;
    }>;
    expect(createBody.code).toBe(ResultCode.SUCCESS);
    const created = expectData(createBody);
    expect(created.currentMedicineId).toBe(medicine.id);
    expect(created.status).toBe('taken');

    const listRes = await request(app.getHttpServer())
      .get(`${BASE_PATH}?date=2026-06-04`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listEnvelope = listRes.body as ApiEnvelope<{
      items: Array<{ id: string }>;
    }>;
    expect(listEnvelope.code).toBe(ResultCode.SUCCESS);
    const listBody = expectData(listEnvelope);
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0]?.id).toBe(created.id);
  });

  it('should reject dose logs linked to another user medicine', async () => {
    const { token } = await createUserWithToken();
    const { user: otherUser } = await createUserWithToken();
    const otherMedicine = await createCurrentMedicine(otherUser.id);

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: otherMedicine.id,
        status: 'taken',
        scheduledFor: '2026-06-04',
      })
      .expect(404);
  });

  it('should update status without clearing omitted nullable fields', async () => {
    const { user, token } = await createUserWithToken();
    const medicine = await createCurrentMedicine(user.id);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: medicine.id,
        status: 'planned',
        scheduledFor: '2026-06-04',
        doseText: '1 tablet',
        note: 'keep this note',
      })
      .expect(201);

    const id = expectData(createRes.body as ApiEnvelope<{ id: string }>).id;

    const updateRes = await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .send({ status: 'skipped' })
      .expect(200);

    const body = expectData(
      updateRes.body as ApiEnvelope<{
        status: string;
        doseText: string | null;
        note: string | null;
      }>,
    );
    expect(body.status).toBe('skipped');
    expect(body.doseText).toBe('1 tablet');
    expect(body.note).toBe('keep this note');
  });

  it('should clear nullable fields when null is sent', async () => {
    const { user, token } = await createUserWithToken();
    const medicine = await createCurrentMedicine(user.id);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: medicine.id,
        status: 'taken',
        scheduledFor: '2026-06-04',
        doseText: '1 tablet',
        note: 'clear me',
      })
      .expect(201);

    const id = expectData(createRes.body as ApiEnvelope<{ id: string }>).id;

    await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .send({ doseText: null, note: null })
      .expect(200);

    const stored = await ctx.prisma.userMedicineDoseLog.findUniqueOrThrow({
      where: { id },
    });
    expect(stored.doseText).toBeNull();
    expect(stored.note).toBeNull();
  });

  it('should soft-delete dose logs', async () => {
    const { token } = await createUserWithToken();

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        status: 'planned',
        scheduledFor: '2026-06-04',
      })
      .expect(201);

    const id = expectData(createRes.body as ApiEnvelope<{ id: string }>).id;

    await request(app.getHttpServer())
      .delete(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get(`${BASE_PATH}?date=2026-06-04`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const body = expectData(listRes.body as ApiEnvelope<{ items: unknown[] }>);
    expect(body.items).toHaveLength(0);
  });

  it('should return 404 for foreign dose-log updates', async () => {
    const { token } = await createUserWithToken();
    const { token: otherToken } = await createUserWithToken();

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        status: 'planned',
        scheduledFor: '2026-06-04',
      })
      .expect(201);

    const id = expectData(createRes.body as ApiEnvelope<{ id: string }>).id;

    await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(otherToken))
      .send({ status: 'taken' })
      .expect(404);
  });

  it('should require auth for dose-log access', async () => {
    await request(app.getHttpServer())
      .get(`${BASE_PATH}?date=2026-06-04`)
      .expect(401);
  });
});
