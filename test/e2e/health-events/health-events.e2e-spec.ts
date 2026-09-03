import request from 'supertest';

import {
  bearer,
  createAccessToken,
  createTestApp,
  createTestUser,
  expectData,
} from '../../helpers/e2e-helpers.js';
import type {
  E2eApp,
  E2eTestContext,
  TestUser,
} from '../../helpers/e2e-helpers.js';
import {
  DailyRecordKind,
  HealthEventOutcome,
  MedicineSource,
} from '#generated/prisma/client.js';

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
    const reasonBody = reasonResponse.body as { id: string };
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
    const createBody = createResponse.body as HealthEventItem;
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
    const activeBody = activeResponse.body as HealthEventItem;
    expect(expectData(activeBody).id).toBe(created.id);

    await request(app.getHttpServer())
      .post(HEALTH_EVENTS_PATH)
      .set('Authorization', bearer(tokenA))
      .send({ title: '第二个 active 事件' })
      .expect(409);

    await request(app.getHttpServer())
      .get(`${HEALTH_EVENTS_PATH}/${created.id}`)
      .set('Authorization', bearer(tokenB))
      .expect(403);

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
      .expect(403);

    const checkInResponse = await request(app.getHttpServer())
      .put(`${HEALTH_EVENTS_PATH}/${created.id}/check-ins/${CHECK_IN_DATE}`)
      .set('Authorization', bearer(tokenA))
      .send({ outcome: HealthEventOutcome.improved })
      .expect(200);
    const checkInBody = checkInResponse.body as HealthEventItem;
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
    const endBody = endResponse.body as HealthEventItem;
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
    const historyBody = historyResponse.body as HealthEventItem;
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
    const listBody = listResponse.body as {
      items: HealthEventItem[];
      total: number;
    };
    const history = expectData(listBody);
    expect(history.total).toBe(1);
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      id: created.id,
      status: 'ended',
      coverage: { checkInCount: 1 },
    });
  }, 30_000);

  it('records server-authoritative product events on the happy path (start → check-in → end)', async () => {
    const user = await createTestUser(ctx.prisma, undefined, 'HealthEventP');
    userIds.push(user.id);
    const token = await createToken(user);

    const createResponse = await request(app.getHttpServer())
      .post(HEALTH_EVENTS_PATH)
      .set('Authorization', bearer(token))
      .send({ title: '测量事件' })
      .expect(201);
    const created = expectData(createResponse.body as HealthEventItem);

    await request(app.getHttpServer())
      .put(`${HEALTH_EVENTS_PATH}/${created.id}/check-ins/${CHECK_IN_DATE}`)
      .set('Authorization', bearer(token))
      .send({ outcome: HealthEventOutcome.improved })
      .expect(200);

    await request(app.getHttpServer())
      .post(`${HEALTH_EVENTS_PATH}/${created.id}/end`)
      .set('Authorization', bearer(token))
      .send({ outcome: HealthEventOutcome.unchanged })
      .expect(201);

    const events = await ctx.prisma.userProductEvent.findMany({
      where: { userId: user.id },
      orderBy: { occurredAt: 'asc' },
    });

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.name)).toEqual([
      'health_event_started',
      'health_event_outcome_confirmed',
      'health_event_ended',
    ]);
    // Server-emitted rows carry the fixed server markers, never a client build.
    for (const event of events) {
      expect(event.appVersion).toBe('server');
      expect(event.platform).toBe('web');
      expect(event.surface).toBe('review');
      expect(event.clientEventId).toMatch(/^server-/);
    }
    expect(events[0]).toMatchObject({
      result: 'success',
      eventStatus: 'active',
      clientEventId: `server-health-started-${created.id}`,
    });
    expect(events[1]).toMatchObject({
      result: 'improved',
      eventStatus: null,
      clientEventId: `server-checkin-${created.id}-${CHECK_IN_DATE}`,
    });
    expect(events[2]).toMatchObject({
      result: 'unchanged',
      eventStatus: 'ended',
      clientEventId: `server-health-ended-${created.id}`,
    });
  }, 30_000);
});
