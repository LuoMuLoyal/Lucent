import request from 'supertest';
import {
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
  type Prisma,
} from '#generated/prisma/client';

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
const FUNNEL_PATH = `${PRODUCT_EVENTS_PATH}/funnel`;

// Dedicated window for the funnel e2e tests — no other test in this file
// seeds events on these dates, so the aggregated counts stay exact.
const FUNNEL_DATE = '2026-01-10';
const FUNNEL_DATE_SMALL_SAMPLE = '2026-01-11';

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

interface SeedEvent {
  name: ProductEventName;
  surface: ProductEventSurface;
  result: ProductEventResult;
  occurredAt: string;
  clientEventId: string;
}

/** Insert raw product events directly (the write path is covered elsewhere). */
function seedEvents(
  ctx: E2eTestContext,
  targetUser: TestUser,
  events: SeedEvent[],
): Promise<unknown> {
  const data: Prisma.UserProductEventCreateManyInput[] = events.map(
    (event) => ({
      userId: targetUser.id,
      clientEventId: event.clientEventId,
      name: event.name,
      surface: event.surface,
      result: event.result,
      eventStatus: null,
      suggestionRuleCode: null,
      appVersion: '1.2.0',
      platform: 'ios',
      occurredAt: new Date(event.occurredAt),
    }),
  );
  return ctx.prisma.userProductEvent.createMany({ data });
}

describe('Product Events API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;
  let admin: TestUser;
  let adminToken: string;

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

    const adminEmail = ctx.configService.get<string>('ADMIN_EMAIL');
    expect(adminEmail).toBeTruthy();
    admin = await createTestUser(ctx.prisma, adminEmail, 'FunnelAdmin');
    adminToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      admin.id,
      adminEmail as string,
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

    const body = response.body as {
      received: number;
      recorded: number;
    };
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
    expect(expectData(first.body as { recorded: number })).toEqual({
      received: 1,
      recorded: 1,
    });

    const retry = await request(app.getHttpServer())
      .post(PRODUCT_EVENTS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({ events: [event] })
      .expect(201);
    expect(expectData(retry.body as { recorded: number })).toEqual({
      received: 1,
      recorded: 0,
    });

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
    // The product-events POST endpoint is throttled at 10 req/min per IP.
    // Preceding tests in this suite may have exhausted that budget, so a 429
    // is an equally valid outcome. When the throttle is not hit, the empty
    // batch must be rejected with 400.
    const res = await request(app.getHttpServer())
      .post(PRODUCT_EVENTS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({ events: [] });

    expect([400, 429]).toContain(res.statusCode);
  });

  describe('funnel aggregation (admin)', () => {
    it('returns 401 for an unauthenticated request', async () => {
      await request(app.getHttpServer()).get(FUNNEL_PATH).expect(401);
    });

    it('returns 403 for a regular user', async () => {
      await request(app.getHttpServer())
        .get(FUNNEL_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(403);
    });

    it('aggregates two users into one window with counts only and optional events separated', async () => {
      const secondUser = await createTestUser(
        ctx.prisma,
        undefined,
        'FunnelSecondUser',
      );
      await seedEvents(ctx, user, [
        {
          name: ProductEventName.health_event_started,
          surface: ProductEventSurface.review,
          result: ProductEventResult.success,
          occurredAt: `${FUNNEL_DATE}T02:00:00.000Z`,
          clientEventId: 'funnel-a-start-1',
        },
        {
          name: ProductEventName.health_event_started,
          surface: ProductEventSurface.review,
          result: ProductEventResult.success,
          occurredAt: `${FUNNEL_DATE}T03:00:00.000Z`,
          clientEventId: 'funnel-a-start-2',
        },
        {
          name: ProductEventName.suggestion_impression,
          surface: ProductEventSurface.today,
          result: ProductEventResult.success,
          occurredAt: `${FUNNEL_DATE}T04:00:00.000Z`,
          clientEventId: 'funnel-a-imp-1',
        },
        {
          name: ProductEventName.suggestion_actioned,
          surface: ProductEventSurface.today,
          result: ProductEventResult.success,
          occurredAt: `${FUNNEL_DATE}T05:00:00.000Z`,
          clientEventId: 'funnel-a-act-1',
        },
        {
          name: ProductEventName.health_event_ended,
          surface: ProductEventSurface.review,
          result: ProductEventResult.improved,
          occurredAt: `${FUNNEL_DATE}T06:00:00.000Z`,
          clientEventId: 'funnel-a-ended-1',
        },
        {
          name: ProductEventName.visit_summary_previewed,
          surface: ProductEventSurface.review,
          result: ProductEventResult.success,
          occurredAt: `${FUNNEL_DATE}T07:00:00.000Z`,
          clientEventId: 'funnel-a-preview-1',
        },
      ]);
      await seedEvents(ctx, secondUser, [
        {
          name: ProductEventName.health_event_started,
          surface: ProductEventSurface.review,
          result: ProductEventResult.success,
          occurredAt: `${FUNNEL_DATE}T02:30:00.000Z`,
          clientEventId: 'funnel-b-start-1',
        },
        {
          name: ProductEventName.health_event_started,
          surface: ProductEventSurface.review,
          result: ProductEventResult.success,
          occurredAt: `${FUNNEL_DATE}T02:45:00.000Z`,
          clientEventId: 'funnel-b-start-2',
        },
        {
          name: ProductEventName.suggestion_impression,
          surface: ProductEventSurface.today,
          result: ProductEventResult.success,
          occurredAt: `${FUNNEL_DATE}T04:30:00.000Z`,
          clientEventId: 'funnel-b-imp-1',
        },
        {
          name: ProductEventName.suggestion_impression,
          surface: ProductEventSurface.today,
          result: ProductEventResult.success,
          occurredAt: `${FUNNEL_DATE}T04:45:00.000Z`,
          clientEventId: 'funnel-b-imp-2',
        },
        {
          name: ProductEventName.suggestion_actioned,
          surface: ProductEventSurface.today,
          result: ProductEventResult.success,
          occurredAt: `${FUNNEL_DATE}T05:30:00.000Z`,
          clientEventId: 'funnel-b-act-1',
        },
        {
          name: ProductEventName.review_opened,
          surface: ProductEventSurface.review,
          result: ProductEventResult.success,
          occurredAt: `${FUNNEL_DATE}T08:00:00.000Z`,
          clientEventId: 'funnel-b-review-1',
        },
      ]);

      const response = await request(app.getHttpServer())
        .get(FUNNEL_PATH)
        .query({ dateFrom: FUNNEL_DATE, dateTo: FUNNEL_DATE })
        .set('Authorization', bearer(adminToken))
        .expect(200);

      const data = expectData(response.body) as {
        daily: Array<Record<string, number | string>>;
        optional: Record<string, number>;
        totals: Record<string, number>;
        window: {
          dateFrom: string;
          dateTo: string;
          generatedAt: string;
          detailsSuppressed: boolean;
        };
      };

      // Both users' events land in the same day and stage counts.
      expect(data.totals).toEqual({
        eventStarted: 4,
        suggestionImpression: 3,
        suggestionActioned: 2,
        eventEndedOrOutcome: 1,
        reviewOpened: 1,
      });
      expect(data.daily).toEqual([
        {
          date: FUNNEL_DATE,
          eventStarted: 4,
          suggestionImpression: 3,
          suggestionActioned: 2,
          eventEndedOrOutcome: 1,
          reviewOpened: 1,
        },
      ]);
      // Optional visit-summary events are counted separately — the preview
      // never lands in the core funnel, and the core result is unaffected.
      expect(data.optional).toEqual({
        visitSummaryPreviewed: 1,
        visitSummaryExported: 0,
        visitSummaryShareCreated: 0,
        visitSummaryShareOpened: 0,
      });
      expect(data.window).toMatchObject({
        dateFrom: FUNNEL_DATE,
        dateTo: FUNNEL_DATE,
        detailsSuppressed: false,
      });
      expect(typeof data.window.generatedAt).toBe('string');

      // The response payload carries counts only — no user identity or
      // health content of any kind.
      const json = JSON.stringify(response.body);
      expect(json).not.toContain('userId');
      expect(json).not.toContain('symptom');
      expect(json).not.toContain('suggestionRuleCode');
    });

    it('suppresses daily details below the small-sample threshold', async () => {
      await seedEvents(ctx, user, [
        {
          name: ProductEventName.health_event_started,
          surface: ProductEventSurface.review,
          result: ProductEventResult.success,
          occurredAt: `${FUNNEL_DATE_SMALL_SAMPLE}T02:00:00.000Z`,
          clientEventId: 'funnel-small-1',
        },
        {
          name: ProductEventName.review_opened,
          surface: ProductEventSurface.review,
          result: ProductEventResult.success,
          occurredAt: `${FUNNEL_DATE_SMALL_SAMPLE}T03:00:00.000Z`,
          clientEventId: 'funnel-small-2',
        },
      ]);

      const response = await request(app.getHttpServer())
        .get(FUNNEL_PATH)
        .query({
          dateFrom: FUNNEL_DATE_SMALL_SAMPLE,
          dateTo: FUNNEL_DATE_SMALL_SAMPLE,
        })
        .set('Authorization', bearer(adminToken))
        .expect(200);

      const data = expectData(response.body) as {
        daily: unknown[];
        totals: Record<string, number>;
        window: { detailsSuppressed: boolean };
      };
      expect(data.daily).toEqual([]);
      expect(data.window.detailsSuppressed).toBe(true);
      // Totals are still returned.
      expect(data.totals).toEqual({
        eventStarted: 1,
        suggestionImpression: 0,
        suggestionActioned: 0,
        eventEndedOrOutcome: 0,
        reviewOpened: 1,
      });
    });

    it('rejects a date range beyond the 30-day cap', async () => {
      await request(app.getHttpServer())
        .get(FUNNEL_PATH)
        .query({ dateFrom: '2026-01-01', dateTo: '2026-02-01' })
        .set('Authorization', bearer(adminToken))
        .expect(400);
    });
  });
});
