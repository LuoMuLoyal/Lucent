import request from 'supertest';
import {
  AdminRole,
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
  type Prisma,
} from '#generated/prisma/client.js';
import {
  bearer,
  cleanupDatabase,
  createAccessToken,
  createTestApp,
  createTestUser,
  uniqueEmail,
} from '../../helpers/e2e-helpers.js';
import type {
  E2eApp,
  E2eTestContext,
  TestUser,
} from '../../helpers/e2e-helpers.js';

const FUNNEL_PATH = '/api/v1/admin/metrics/funnel';
const LEGACY_FUNNEL_PATH = '/api/v1/user/product-events/funnel';

// Dedicated window for this file — no other e2e seeds events on this date, so
// the aggregated counts stay exact.
const WINDOW_DATE = '2026-03-05';
const SECOND_WINDOW_DATE = '2026-03-06';

interface SeedEvent {
  name: ProductEventName;
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
      surface: ProductEventSurface.review,
      result: ProductEventResult.success,
      eventStatus: null,
      suggestionRuleCode: null,
      appVersion: '1.2.0',
      platform: 'ios',
      occurredAt: new Date(event.occurredAt),
    }),
  );
  return ctx.prisma.userProductEvent.createMany({ data });
}

async function adminTokenFor(
  ctx: E2eTestContext,
  user: TestUser,
): Promise<string> {
  return createAccessToken(
    ctx.jwtService,
    ctx.configService,
    user.id,
    user.email,
  );
}

describe('Admin metrics API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  let opsAdmin: TestUser;
  let opsToken: string;
  let editor: TestUser;
  let editorToken: string;
  let outsider: TestUser;
  let outsiderToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    opsAdmin = await createTestUser(ctx.prisma, uniqueEmail('metrics'), 'Ops');
    await ctx.prisma.adminUser.create({
      data: { userId: opsAdmin.id, role: AdminRole.ADMIN },
    });
    opsToken = await adminTokenFor(ctx, opsAdmin);

    editor = await createTestUser(ctx.prisma, uniqueEmail('editor'), 'Editor');
    await ctx.prisma.adminUser.create({
      data: { userId: editor.id, role: AdminRole.EDITOR },
    });
    editorToken = await adminTokenFor(ctx, editor);

    outsider = await createTestUser(
      ctx.prisma,
      uniqueEmail('outsider'),
      'Outsider',
    );
    outsiderToken = await adminTokenFor(ctx, outsider);

    await seedEvents(ctx, opsAdmin, [
      {
        name: ProductEventName.health_event_started,
        occurredAt: `${WINDOW_DATE}T02:00:00.000Z`,
        clientEventId: 'admin-metrics-start-1',
      },
      {
        name: ProductEventName.health_event_started,
        occurredAt: `${WINDOW_DATE}T02:30:00.000Z`,
        clientEventId: 'admin-metrics-start-2',
      },
      {
        name: ProductEventName.suggestion_impression,
        occurredAt: `${WINDOW_DATE}T04:00:00.000Z`,
        clientEventId: 'admin-metrics-imp-1',
      },
      {
        name: ProductEventName.review_opened,
        occurredAt: `${WINDOW_DATE}T08:00:00.000Z`,
        clientEventId: 'admin-metrics-review-1',
      },
      {
        name: ProductEventName.review_opened,
        occurredAt: `${SECOND_WINDOW_DATE}T08:00:00.000Z`,
        clientEventId: 'admin-metrics-review-2',
      },
    ]);
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  describe('permission gates', () => {
    it('returns 401 for an unauthenticated request', async () => {
      await request(app.getHttpServer()).get(FUNNEL_PATH).expect(401);
    });

    it('returns 403 for a non-admin account', async () => {
      await request(app.getHttpServer())
        .get(FUNNEL_PATH)
        .set('Authorization', bearer(outsiderToken))
        .expect(403);
    });

    it('returns 403 for an editor without metrics:read', async () => {
      await request(app.getHttpServer())
        .get(FUNNEL_PATH)
        .set('Authorization', bearer(editorToken))
        .expect(403);
    });
  });

  describe('aggregation', () => {
    it('aggregates the requested window with counts only', async () => {
      const response = await request(app.getHttpServer())
        .get(FUNNEL_PATH)
        .query({ dateFrom: WINDOW_DATE, dateTo: WINDOW_DATE })
        .set('Authorization', bearer(opsToken))
        .expect(200);

      expect(response.body).toMatchObject({
        totals: {
          eventStarted: 2,
          suggestionImpression: 1,
          suggestionActioned: 0,
          eventEndedOrOutcome: 0,
          reviewOpened: 1,
        },
        window: {
          dateFrom: WINDOW_DATE,
          dateTo: WINDOW_DATE,
          detailsSuppressed: false,
        },
      });
      expect(response.body.daily).toEqual([
        {
          date: WINDOW_DATE,
          eventStarted: 2,
          suggestionImpression: 1,
          suggestionActioned: 0,
          eventEndedOrOutcome: 0,
          reviewOpened: 1,
        },
      ]);
      // Counts only: no user identity, health content or rule codes.
      const json = JSON.stringify(response.body);
      expect(json).not.toContain('userId');
      expect(json).not.toContain('symptom');
      expect(json).not.toContain('suggestionRuleCode');
    });

    it('matches the pre-existing product-events funnel payload', async () => {
      const query = { dateFrom: WINDOW_DATE, dateTo: SECOND_WINDOW_DATE };
      const admin = await request(app.getHttpServer())
        .get(FUNNEL_PATH)
        .query(query)
        .set('Authorization', bearer(opsToken))
        .expect(200);
      const legacy = await request(app.getHttpServer())
        .get(LEGACY_FUNNEL_PATH)
        .query(query)
        .set('Authorization', bearer(opsToken))
        .expect(200);

      expect(admin.body.daily).toEqual(legacy.body.daily);
      expect(admin.body.totals).toEqual(legacy.body.totals);
      expect(admin.body.optional).toEqual(legacy.body.optional);
      expect(admin.body.window).toMatchObject({
        dateFrom: legacy.body.window.dateFrom,
        dateTo: legacy.body.window.dateTo,
        detailsSuppressed: legacy.body.window.detailsSuppressed,
      });
    });
  });

  describe('window validation', () => {
    it('rejects a partial window', async () => {
      await request(app.getHttpServer())
        .get(FUNNEL_PATH)
        .query({ dateFrom: WINDOW_DATE })
        .set('Authorization', bearer(opsToken))
        .expect(400);
    });

    it('rejects a window whose end precedes its start', async () => {
      await request(app.getHttpServer())
        .get(FUNNEL_PATH)
        .query({ dateFrom: SECOND_WINDOW_DATE, dateTo: WINDOW_DATE })
        .set('Authorization', bearer(opsToken))
        .expect(400);
    });

    it('rejects a window longer than the range cap', async () => {
      await request(app.getHttpServer())
        .get(FUNNEL_PATH)
        .query({ dateFrom: '2026-01-01', dateTo: '2026-02-15' })
        .set('Authorization', bearer(opsToken))
        .expect(400);
    });

    it('rejects unknown query keys', async () => {
      await request(app.getHttpServer())
        .get(FUNNEL_PATH)
        .query({ dateFrom: WINDOW_DATE, limit: 10 })
        .set('Authorization', bearer(opsToken))
        .expect(400);
    });
  });
});
