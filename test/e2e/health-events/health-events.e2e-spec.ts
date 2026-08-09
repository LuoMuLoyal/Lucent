import request from 'supertest';

import { ResultCode } from '../../../src/common';
import type { ApiEnvelope } from '../../../src/common';
import {
  bearer,
  createAccessToken,
  createTestApp,
  createTestUser,
  expectData,
} from '../../helpers/e2e-helpers';
import type {
  E2eApp,
  E2eTestContext,
  TestUser,
} from '../../helpers/e2e-helpers';
import {
  DailyRecordKind,
  HealthEventOutcome,
  MedicineSource,
} from '#generated/prisma/client';

const HEALTH_EVENTS_PATH = '/api/v1/user/health-events';
const DAILY_RECORDS_PATH = '/api/v1/user/daily-records';
const CHECK_IN_DATE = '2026-08-09';

interface HealthEventItem {
  id: string;
  reasonRecordId: string | null;
  currentMedicineIds: string[];
  status: 'active' | 'ended';
  endedAt: string | null;
  outcome: HealthEventOutcome | null;
  checkIn: {
    date: string;
    outcome: HealthEventOutcome;
  } | null;
  coverage: {
    checkInCount: number;
    firstCheckInDate: string | null;
    lastCheckInDate: string | null;
  };
}

describe('Health Event Contract API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  const userIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    for (const userId of userIds) {
      await ctx.prisma.user
        .delete({ where: { id: userId } })
        .catch(() => undefined);
    }
    await app.close();
  });

  async function createToken(user: TestUser): Promise<string> {
    return createAccessToken(
      ctx.jwtService,
      ctx.configService,
      user.id,
      user.email,
    );
  }

  it('isolates ownership and completes the explicit event lifecycle', async () => {
    const userA = await createTestUser(ctx.prisma, undefined, 'HealthEventA');
    const userB = await createTestUser(ctx.prisma, undefined, 'HealthEventB');
    userIds.push(userA.id, userB.id);

    const tokenA = await createToken(userA);
    const tokenB = await createToken(userB);

    const reasonResponse = await request(app.getHttpServer())
      .post(DAILY_RECORDS_PATH)
      .set('Authorization', bearer(tokenA))
      .send({
        kind: DailyRecordKind.symptom,
        occurredAt: CHECK_IN_DATE,
        title: '发热',
      })
      .expect(201);
    const reasonBody = reasonResponse.body as ApiEnvelope<{ id: string }>;
    expect(reasonBody.code).toBe(ResultCode.SUCCESS);
    const reasonRecord = expectData(reasonBody);
    const currentMedicine = await ctx.prisma.userCurrentMedicine.create({
      data: {
        userId: userA.id,
        source: MedicineSource.manual,
        displayName: '验收用短期药物',
        doseText: '1 tablet',
      },
    });

    const createResponse = await request(app.getHttpServer())
      .post(HEALTH_EVENTS_PATH)
      .set('Authorization', bearer(tokenA))
      .send({
        title: '真实验收事件',
        reasonRecordId: reasonRecord.id,
        currentMedicineIds: [currentMedicine.id],
      })
      .expect(201);
    const createBody = createResponse.body as ApiEnvelope<HealthEventItem>;
    expect(createBody.code).toBe(ResultCode.SUCCESS);
    const created = expectData(createBody);
    expect(created.reasonRecordId).toBe(reasonRecord.id);
    expect(created.currentMedicineIds).toEqual([currentMedicine.id]);
    expect(created.status).toBe('active');
    expect(created.outcome).toBeNull();
    expect(created.checkIn).toBeNull();
    expect(created.coverage.checkInCount).toBe(0);

    const activeResponse = await request(app.getHttpServer())
      .get(`${HEALTH_EVENTS_PATH}/active`)
      .set('Authorization', bearer(tokenA))
      .expect(200);
    const activeBody = activeResponse.body as ApiEnvelope<HealthEventItem>;
    expect(activeBody.code).toBe(ResultCode.SUCCESS);
    expect(expectData(activeBody).id).toBe(created.id);

    await request(app.getHttpServer())
      .post(HEALTH_EVENTS_PATH)
      .set('Authorization', bearer(tokenA))
      .send({ title: '第二个 active 事件' })
      .expect(409);

    await request(app.getHttpServer())
      .get(`${HEALTH_EVENTS_PATH}/${created.id}`)
      .set('Authorization', bearer(tokenB))
      .expect(404);

    await request(app.getHttpServer())
      .post(DAILY_RECORDS_PATH)
      .set('Authorization', bearer(tokenB))
      .send({
        kind: DailyRecordKind.water,
        occurredAt: CHECK_IN_DATE,
        value: '1',
        unit: '杯',
        healthEventId: created.id,
      })
      .expect(404);

    const checkInResponse = await request(app.getHttpServer())
      .put(`${HEALTH_EVENTS_PATH}/${created.id}/check-ins/${CHECK_IN_DATE}`)
      .set('Authorization', bearer(tokenA))
      .send({ outcome: HealthEventOutcome.improved })
      .expect(200);
    const checkInBody = checkInResponse.body as ApiEnvelope<HealthEventItem>;
    expect(checkInBody.code).toBe(ResultCode.SUCCESS);
    const checkedIn = expectData(checkInBody);
    expect(checkedIn.status).toBe('active');
    expect(checkedIn.checkIn).toMatchObject({
      date: CHECK_IN_DATE,
      outcome: HealthEventOutcome.improved,
    });
    expect(checkedIn.coverage).toMatchObject({
      checkInCount: 1,
      firstCheckInDate: CHECK_IN_DATE,
      lastCheckInDate: CHECK_IN_DATE,
    });

    const endResponse = await request(app.getHttpServer())
      .post(`${HEALTH_EVENTS_PATH}/${created.id}/end`)
      .set('Authorization', bearer(tokenA))
      .send({ outcome: HealthEventOutcome.unchanged })
      .expect(201);
    const endBody = endResponse.body as ApiEnvelope<HealthEventItem>;
    expect(endBody.code).toBe(ResultCode.SUCCESS);
    const ended = expectData(endBody);
    expect(ended).toMatchObject({
      id: created.id,
      status: 'ended',
      outcome: HealthEventOutcome.unchanged,
    });
    expect(ended.endedAt).not.toBeNull();

    const historyResponse = await request(app.getHttpServer())
      .get(`${HEALTH_EVENTS_PATH}/${created.id}?date=${CHECK_IN_DATE}`)
      .set('Authorization', bearer(tokenA))
      .expect(200);
    const historyBody = historyResponse.body as ApiEnvelope<HealthEventItem>;
    expect(historyBody.code).toBe(ResultCode.SUCCESS);
    expect(expectData(historyBody)).toMatchObject({
      id: created.id,
      status: 'ended',
      outcome: HealthEventOutcome.unchanged,
      checkIn: {
        date: CHECK_IN_DATE,
        outcome: HealthEventOutcome.improved,
      },
    });

    const listResponse = await request(app.getHttpServer())
      .get(`${HEALTH_EVENTS_PATH}?date=${CHECK_IN_DATE}`)
      .set('Authorization', bearer(tokenA))
      .expect(200);
    const listBody = listResponse.body as ApiEnvelope<{
      items: HealthEventItem[];
      total: number;
    }>;
    expect(listBody.code).toBe(ResultCode.SUCCESS);
    const history = expectData(listBody);
    expect(history.total).toBe(1);
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      id: created.id,
      status: 'ended',
      coverage: { checkInCount: 1 },
    });
  }, 30_000);
});
