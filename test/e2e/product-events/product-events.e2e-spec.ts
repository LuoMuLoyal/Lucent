import request from 'supertest';

import type { ApiEnvelope } from '../../../src/common';
import { ResultCode } from '../../../src/common';
import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
  expectData,
} from '../../helpers/e2e-helpers';
import type {
  E2eTestContext,
  E2eApp,
  TestUser,
} from '../../helpers/e2e-helpers';

const PRODUCT_EVENTS_PATH = '/api/v1/user/product-events';

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    name: 'review_opened',
    surface: 'review',
    result: 'success',
    appVersion: '1.2.0',
    platform: 'ios',
    occurredAt: '2026-08-14T02:00:00.000Z',
    clientEventId: `client-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

describe('Product Events API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(ctx.prisma, undefined, 'ProductEventsUser');
    accessToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      user.id,
      user.email,
    );
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  it('should return 401 for unauthenticated request', async () => {
    await request(app.getHttpServer())
      .post(PRODUCT_EVENTS_PATH)
      .send({ events: [validEvent()] })
      .expect(401);
  });

  it('records a batch and reports received/recorded counts', async () => {
    const response = await request(app.getHttpServer())
      .post(PRODUCT_EVENTS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({
        events: [
          validEvent(),
          validEvent({
            name: 'suggestion_impression',
            surface: 'today',
            suggestionRuleCode: 'water_behind_target',
          }),
        ],
      })
      .expect(201);

    const body = response.body as ApiEnvelope<{
      received: number;
      recorded: number;
    }>;
    expect(body.code).toBe(ResultCode.SUCCESS);
    expect(expectData(body)).toEqual({ received: 2, recorded: 2 });
  });

  it('persists only whitelisted attributes under the session user', async () => {
    const event = validEvent({
      name: 'health_event_ended',
      result: 'improved',
      eventStatus: 'ended',
    });
    await request(app.getHttpServer())
      .post(PRODUCT_EVENTS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({ events: [event] })
      .expect(201);

    const row = await ctx.prisma.userProductEvent.findUnique({
      where: {
        userId_clientEventId: {
          userId: user.id,
          clientEventId: event.clientEventId as string,
        },
      },
    });

    expect(row).toMatchObject({
      userId: user.id,
      name: 'health_event_ended',
      surface: 'review',
      result: 'improved',
      eventStatus: 'ended',
      suggestionRuleCode: null,
      appVersion: '1.2.0',
      platform: 'ios',
    });
  });

  it('is idempotent on clientEventId: retries never double-insert', async () => {
    const event = validEvent();

    const first = await request(app.getHttpServer())
      .post(PRODUCT_EVENTS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({ events: [event] })
      .expect(201);
    expect(expectData(first.body as ApiEnvelope<{ recorded: number }>)).toEqual(
      {
        received: 1,
        recorded: 1,
      },
    );

    const retry = await request(app.getHttpServer())
      .post(PRODUCT_EVENTS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({ events: [event] })
      .expect(201);
    expect(expectData(retry.body as ApiEnvelope<{ recorded: number }>)).toEqual(
      {
        received: 1,
        recorded: 0,
      },
    );

    const count = await ctx.prisma.userProductEvent.count({
      where: {
        userId: user.id,
        clientEventId: event.clientEventId as string,
      },
    });
    expect(count).toBe(1);
  });

  it('rejects a client-supplied userId (whitelist)', async () => {
    await request(app.getHttpServer())
      .post(PRODUCT_EVENTS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({ events: [validEvent({ userId: 'attacker-id' })] })
      .expect(400);
  });

  it('rejects free-text metadata (whitelist)', async () => {
    await request(app.getHttpServer())
      .post(PRODUCT_EVENTS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({
        events: [validEvent({ metadata: { symptom: 'headache' } })],
      })
      .expect(400);
  });

  it('rejects a batch above the size limit', async () => {
    const events = Array.from({ length: 51 }, (_, index) =>
      validEvent({ clientEventId: `over-${String(index)}` }),
    );

    await request(app.getHttpServer())
      .post(PRODUCT_EVENTS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({ events })
      .expect(400);
  });

  it('rejects an unknown suggestion rule code with 400 and writes nothing', async () => {
    const before = await ctx.prisma.userProductEvent.count({
      where: { userId: user.id },
    });

    await request(app.getHttpServer())
      .post(PRODUCT_EVENTS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({
        events: [
          validEvent({
            clientEventId: 'bad-rule-1',
            suggestionRuleCode: 'free-form',
          }),
          validEvent({ clientEventId: 'bad-rule-2' }),
        ],
      })
      .expect(400);

    const after = await ctx.prisma.userProductEvent.count({
      where: { userId: user.id },
    });
    expect(after).toBe(before);
  });

  it('rejects an invalid enum value', async () => {
    await request(app.getHttpServer())
      .post(PRODUCT_EVENTS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({ events: [validEvent({ name: 'not_an_event' })] })
      .expect(400);
  });

  it('rejects an empty batch', async () => {
    await request(app.getHttpServer())
      .post(PRODUCT_EVENTS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({ events: [] })
      .expect(400);
  });
});
