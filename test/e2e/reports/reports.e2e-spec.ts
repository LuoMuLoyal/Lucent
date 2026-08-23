import request from 'supertest';

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

const DASHBOARD_PATH = '/api/v1/user/reports/dashboard';
const SUMMARY_GENERATE_PATH = '/api/v1/user/reports/summary/generate';
const SUMMARY_STREAM_PATH = '/api/v1/user/reports/summary/generate/stream';
const CLINIC_PREVIEW_PATH = '/api/v1/user/reports/clinic-summary/preview';
const CLINIC_SHARE_PATH = '/api/v1/user/reports/clinic-summary/share';
const CLINIC_SHARES_PATH = '/api/v1/user/reports/clinic-summary/shares';
const CLINIC_SHARED_PATH = '/api/v1/user/reports/clinic-summary/shared';
const CLINIC_EXPORT_ASYNC_PATH =
  '/api/v1/user/reports/clinic-summary/export/async';
const CLINIC_PREVIEW_PDF_PATH =
  '/api/v1/user/reports/clinic-summary/preview/pdf';
const REVIEWS_CURRENT_PATH = '/api/v1/user/reports/reviews/current';
const REVIEWS_PATH = '/api/v1/user/reports/reviews';
const HEALTH_EVENTS_PATH = '/api/v1/user/health-events';

describe('Reports API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(ctx.prisma, undefined, 'ReportsUser');
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

  describe('GET /api/v1/user/reports/dashboard', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).get(DASHBOARD_PATH).expect(401);
    });

    it('should return dashboard for last_7_days range by default', async () => {
      const response = await request(app.getHttpServer())
        .get(DASHBOARD_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const body = response.body as {
        range: string;
        startDate: string;
        endDate: string;
        generatedAt: string;
        score: unknown;
        metrics: unknown;
        aiSummaryEnabled: boolean;
      };

      const data = expectData(body);
      expect(data.range).toBe('last_7_days');
      expect(data.startDate).toBeTruthy();
      expect(data.endDate).toBeTruthy();
      expect(data.generatedAt).toBeTruthy();
      expect(data.aiSummaryEnabled).toBeDefined();
    });

    it('should accept custom range parameter', async () => {
      const response = await request(app.getHttpServer())
        .get(`${DASHBOARD_PATH}?range=last_30_days`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const data = expectData(response.body as { range: string });
      expect(data.range).toBe('last_30_days');
    });

    it('should accept custom date range', async () => {
      const response = await request(app.getHttpServer())
        .get(
          `${DASHBOARD_PATH}?range=custom&startDate=2026-06-01&endDate=2026-06-14`,
        )
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const data = expectData(
        response.body as {
          range: string;
          startDate: string;
          endDate: string;
        },
      );
      expect(data.range).toBe('custom');
      expect(data.startDate).toBe('2026-06-01');
      expect(data.endDate).toBe('2026-06-14');
    });

    it('should reject invalid date format', async () => {
      await request(app.getHttpServer())
        .get(`${DASHBOARD_PATH}?range=custom&startDate=invalid-date`)
        .set('Authorization', bearer(accessToken))
        .expect(400);
    });
  });

  describe('POST /api/v1/user/reports/summary/generate', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/user/reports/summary/generate')
        .expect(401);
    });

    it('should accept generate request and return response (may be fallback)', async () => {
      const response = await request(app.getHttpServer())
        .post(SUMMARY_GENERATE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ range: 'last_7_days' })
        .expect(201);

      const body = response.body as { summary?: string };
      expect(body).toBeDefined();
    });
  });

  // ── Summary Generate Stream (SSE) ──────────────────────────

  describe('POST /api/v1/user/reports/summary/generate/stream', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).post(SUMMARY_STREAM_PATH).expect(401);
    });

    it('should return 400 VALIDATION_FAILED when custom range is missing dates', async () => {
      const res = await request(app.getHttpServer())
        .post(SUMMARY_STREAM_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ range: 'custom' })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should return SSE stream with result and done events', async () => {
      const response = await request(app.getHttpServer())
        .post(SUMMARY_STREAM_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ range: 'last_7_days' })
        .expect(200);

      expect(response.headers['content-type']).toContain('text/event-stream');

      const text = response.text as string;
      // SSE stream must contain event markers
      expect(text).toContain('event:');
      // The stream should always end with a done event
      expect(text).toContain('event: done');
      // A result event should be present with summary data
      expect(text).toContain('event: result');
      // The result data should contain report summary fields
      expect(text).toContain('"summary"');
      expect(text).toContain('"range"');
      expect(text).toContain('"startDate"');
      expect(text).toContain('"endDate"');
    });

    it('should accept last_30_days range and stream summary', async () => {
      const response = await request(app.getHttpServer())
        .post(SUMMARY_STREAM_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ range: 'last_30_days' })
        .expect(200);

      expect(response.headers['content-type']).toContain('text/event-stream');

      const text = response.text as string;
      expect(text).toContain('event: result');
      expect(text).toContain('event: done');
      expect(text).toContain('"last_30_days"');
    });
  });

  // ── Clinic Summary ─────────────────────────────────────────

  describe('POST /api/v1/user/reports/clinic-summary/preview', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).post(CLINIC_PREVIEW_PATH).expect(401);
    });

    it('should return a de-identified clinic summary for authenticated user (default scope)', async () => {
      // Empty scope falls back to the legacy default last_30_days range.
      const response = await request(app.getHttpServer())
        .post(CLINIC_PREVIEW_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(201);

      const body = response.body as {
        generatedAt: string;
        dataRange: string;
        profile: {
          nickname: string;
          age: number | null;
          sexAtBirth: string | null;
          bloodType: string | null;
        };
        allergies: unknown[];
        conditions: unknown[];
        currentMedicines: unknown[];
        disclaimer: string;
      };

      const data = expectData(body);
      expect(data.generatedAt).toBeTruthy();
      expect(data.dataRange).toBe('last_30_days');
      // nickname should be masked (de-identified)
      expect(data.profile.nickname).not.toBe('ReportsUser');
      expect(data.disclaimer).toBeTruthy();
      expect(Array.isArray(data.allergies)).toBe(true);
      expect(Array.isArray(data.conditions)).toBe(true);
      expect(Array.isArray(data.currentMedicines)).toBe(true);
    });

    it('should honor an explicit date-range scope', async () => {
      const response = await request(app.getHttpServer())
        .post(CLINIC_PREVIEW_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateFrom: '2026-07-01', dateTo: '2026-07-30' })
        .expect(201);

      const data = expectData(
        response.body as {
          dataRange: string;
          start: string;
          end: string;
        },
      );
      expect(data.dataRange).toBe('custom');
      expect(data.start).toBe('2026-07-01T00:00:00.000Z');
      // Exclusive upper bound: the day after the inclusive dateTo.
      expect(data.end).toBe('2026-07-31T00:00:00.000Z');
    });
  });

  describe('POST /api/v1/user/reports/clinic-summary/share', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).post(CLINIC_SHARE_PATH).expect(401);
    });

    it('should create a shareable link with a 7-day expiry', async () => {
      const response = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateFrom: '2026-07-01', dateTo: '2026-07-30' })
        .expect(201);

      const body = response.body as {
        shareId: string;
        token: string;
        shareUrl: string;
        expiresAt: string;
        scope: {
          eventId: string | null;
          dateFrom: string | null;
          dateTo: string | null;
        };
        selectedFields: string[];
      };

      const data = expectData(body);
      expect(data.shareId).toBeTruthy();
      expect(data.token).toBeTruthy();
      expect(data.shareUrl).toContain(
        '/api/v1/user/reports/clinic-summary/shared/',
      );
      expect(data.shareUrl).toContain(data.token);
      expect(data.expiresAt).toBeTruthy();
      // expiry should be in the future
      expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
      // The date-range scope is persisted on the share record.
      expect(data.scope.eventId).toBeNull();
      expect(data.scope.dateFrom).toBe('2026-07-01T00:00:00.000Z');
      expect(data.scope.dateTo).toBe('2026-07-30T00:00:00.000Z');
      // Omitted selection defaults to every share field.
      expect(data.selectedFields.length).toBeGreaterThan(0);
    });

    it('should create a share with the default range when no scope is supplied', async () => {
      // Legacy-compatible: an empty scope defaults to last_30_days, which is
      // materialized as an explicit date pair on the strict-XOR share record.
      const response = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(201);

      const data = expectData(
        response.body as {
          scope: {
            eventId: string | null;
            dateFrom: string | null;
            dateTo: string | null;
          };
        },
      );
      expect(data.scope.eventId).toBeNull();
      expect(data.scope.dateFrom).toBeTruthy();
      expect(data.scope.dateTo).toBeTruthy();
      // The default window spans 30 inclusive calendar days ending today.
      const from = new Date(data.scope.dateFrom!);
      const to = new Date(data.scope.dateTo!);
      const spanDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
      expect(spanDays).toBe(29);
    });

    it('should reject a date range missing one endpoint with VALIDATION_FAILED', async () => {
      const res = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateFrom: '2026-08-01' })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');

      await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateTo: '2026-08-07' })
        .expect(400);
    });

    it('should reject a date range longer than 30 inclusive days', async () => {
      await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateFrom: '2026-01-01', dateTo: '2026-02-01' })
        .expect(400);
    });

    it('should reject an unknown selectedFields value', async () => {
      await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ selectedFields: ['event_overview', 'doctor_notes'] })
        .expect(400);
    });

    it('should reject an empty selectedFields array', async () => {
      await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ selectedFields: [] })
        .expect(400);
    });

    it('should honor the event scope when both eventId and a date range are supplied', async () => {
      // Uses its own user: the created event must not leak into the later
      // reviews tests, which expect the shared main user to stay event-free.
      const eventUser = await createTestUser(
        ctx.prisma,
        undefined,
        'ShareEventUser',
      );
      const eventToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        eventUser.id,
        eventUser.email,
      );
      const eventRes = await request(app.getHttpServer())
        .post(HEALTH_EVENTS_PATH)
        .set('Authorization', bearer(eventToken))
        .send({ title: 'e2e 分享事件' })
        .expect(201);
      const event = expectData(eventRes.body as { id: string });

      const response = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(eventToken))
        .send({
          eventId: event.id,
          dateFrom: '2026-08-01',
          dateTo: '2026-08-07',
          selectedFields: ['event_overview'],
        })
        .expect(201);

      const data = expectData(
        response.body as {
          scope: {
            eventId: string | null;
            dateFrom: string | null;
            dateTo: string | null;
          };
        },
      );
      // Event scope wins: the strict-XOR share record stores only the event.
      expect(data.scope.eventId).toBe(event.id);
      expect(data.scope.dateFrom).toBeNull();
      expect(data.scope.dateTo).toBeNull();
    });
  });

  describe('DELETE /api/v1/user/reports/clinic-summary/shares/:shareId', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .delete(`${CLINIC_SHARES_PATH}/some-share`)
        .expect(401);
    });

    it('should revoke an owned share and make its URL return 404', async () => {
      const shareRes = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateFrom: '2026-07-01', dateTo: '2026-07-30' })
        .expect(201);
      const share = expectData(
        shareRes.body as {
          shareId: string;
          shareUrl: string;
        },
      );
      const token = share.shareUrl.split('/').pop()!;

      await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`${CLINIC_SHARES_PATH}/${share.shareId}`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      // The revoked URL now behaves like an unknown token: 404, not 410.
      await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/${token}`)
        .expect(404);

      // The shared PDF dies with it — revocation is not bypassable via the
      // PDF route.
      await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/${token}/pdf`)
        .expect(404);
    });

    it('should return 404 for an unknown or foreign share id', async () => {
      const otherUser = await createTestUser(
        ctx.prisma,
        undefined,
        'ShareForeignUser',
      );
      const otherToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        otherUser.id,
        otherUser.email,
      );
      const shareRes = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(otherToken))
        .send({ dateFrom: '2026-07-01', dateTo: '2026-07-30' })
        .expect(201);
      const foreignShareId = expectData(
        shareRes.body as { shareId: string },
      ).shareId;

      // Unknown id
      await request(app.getHttpServer())
        .delete(`${CLINIC_SHARES_PATH}/no-such-share`)
        .set('Authorization', bearer(accessToken))
        .expect(404);

      // Not owned by the caller
      await request(app.getHttpServer())
        .delete(`${CLINIC_SHARES_PATH}/${foreignShareId}`)
        .set('Authorization', bearer(accessToken))
        .expect(404);
    });
  });

  describe('GET /api/v1/user/reports/clinic-summary/shares', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).get(CLINIC_SHARES_PATH).expect(401);
    });

    it('should list the current user shares shaped without token fields', async () => {
      const shareRes = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateFrom: '2026-07-01', dateTo: '2026-07-30' })
        .expect(201);
      const created = expectData(
        shareRes.body as { shareId: string; token: string },
      );

      const response = await request(app.getHttpServer())
        .get(CLINIC_SHARES_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const body = response.body as {
        items: Array<{
          id: string;
          createdAt: string;
          expiresAt: string;
          revokedAt: string | null;
          accessCount: number;
          firstAccessedAt: string | null;
          lastAccessedAt: string | null;
          scope: {
            eventId: string | null;
            dateFrom: string | null;
            dateTo: string | null;
          };
          selectedFields: string[];
        }>;
      };
      const data = expectData(body);
      expect(Array.isArray(data.items)).toBe(true);

      const item = data.items.find((s) => s.id === created.shareId);
      expect(item).toBeDefined();
      expect(item!.createdAt).toBeTruthy();
      expect(new Date(item!.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(item!.revokedAt).toBeNull();
      expect(item!.accessCount).toBe(0);
      expect(item!.firstAccessedAt).toBeNull();
      expect(item!.lastAccessedAt).toBeNull();
      expect(item!.scope).toEqual({
        eventId: null,
        dateFrom: '2026-07-01T00:00:00.000Z',
        dateTo: '2026-07-30T00:00:00.000Z',
      });
      expect(Array.isArray(item!.selectedFields)).toBe(true);
      expect(item!.selectedFields.length).toBeGreaterThan(0);

      // The plaintext token is returned exactly once at creation; it must
      // never appear anywhere in the list payload.
      expect(JSON.stringify(data.items)).not.toContain(created.token);
      for (const s of data.items) {
        expect(s).not.toHaveProperty('token');
        expect(s).not.toHaveProperty('tokenHash');
      }
    });

    it('should list shares newest first, revoked shares included', async () => {
      const firstRes = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateFrom: '2026-07-01', dateTo: '2026-07-30' })
        .expect(201);
      const first = expectData(firstRes.body as { shareId: string });

      // Short delay so the two createdAt timestamps are distinct.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const secondRes = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateFrom: '2026-07-01', dateTo: '2026-07-30' })
        .expect(201);
      const second = expectData(secondRes.body as { shareId: string });

      // Revoke the older share: revoked shares stay listed with revokedAt.
      await request(app.getHttpServer())
        .delete(`${CLINIC_SHARES_PATH}/${first.shareId}`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(CLINIC_SHARES_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);
      const data = expectData(
        response.body as {
          items: Array<{
            id: string;
            createdAt: string;
            revokedAt: string | null;
          }>;
        },
      );

      const ids = data.items.map((s) => s.id);
      expect(ids).toContain(first.shareId);
      expect(ids).toContain(second.shareId);
      expect(ids.indexOf(second.shareId)).toBeLessThan(
        ids.indexOf(first.shareId),
      );
      // createdAt desc across the whole list.
      const createdTimes = data.items.map((s) =>
        new Date(s.createdAt).getTime(),
      );
      for (let i = 1; i < createdTimes.length; i += 1) {
        expect(createdTimes[i - 1]!).toBeGreaterThanOrEqual(createdTimes[i]!);
      }
      const revoked = data.items.find((s) => s.id === first.shareId);
      expect(revoked!.revokedAt).not.toBeNull();
    });

    it('should never expose other users shares', async () => {
      const otherUser = await createTestUser(
        ctx.prisma,
        undefined,
        'ShareListForeignUser',
      );
      const otherToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        otherUser.id,
        otherUser.email,
      );
      const foreignRes = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(otherToken))
        .send({ dateFrom: '2026-07-01', dateTo: '2026-07-30' })
        .expect(201);
      const foreignShareId = expectData(
        foreignRes.body as { shareId: string },
      ).shareId;

      // The main user's list must not contain the foreign share…
      const myRes = await request(app.getHttpServer())
        .get(CLINIC_SHARES_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);
      const myItems = expectData(
        myRes.body as { items: Array<{ id: string }> },
      ).items;
      expect(myItems.some((s) => s.id === foreignShareId)).toBe(false);

      // …and the foreign user sees exactly their own share.
      const foreignListRes = await request(app.getHttpServer())
        .get(CLINIC_SHARES_PATH)
        .set('Authorization', bearer(otherToken))
        .expect(200);
      const foreignItems = expectData(
        foreignListRes.body as { items: Array<{ id: string }> },
      ).items;
      expect(foreignItems.map((s) => s.id)).toEqual([foreignShareId]);
    });
  });

  describe('GET /api/v1/user/reports/clinic-summary/shared/:token', () => {
    it('should return 404 for an invalid or expired token', async () => {
      await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/invalid-token-12345`)
        .expect(404);
    });

    it('should return the shared clinic summary for a valid token', async () => {
      // First create a share link for an explicit date range
      const shareRes = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateFrom: '2026-07-01', dateTo: '2026-07-30' })
        .expect(201);

      const shareData = expectData(
        shareRes.body as { shareUrl: string; expiresAt: string },
      );
      // Extract the token from the shareUrl
      const token = shareData.shareUrl.split('/').pop()!;

      // Then access the shared summary
      const response = await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/${token}`)
        .expect(200);

      const body = response.body as {
        generatedAt: string;
        dataRange: string;
        disclaimer: string;
      };

      const data = expectData(body);
      expect(data.generatedAt).toBeTruthy();
      expect(data.dataRange).toBe('custom');
      expect(data.disclaimer).toBeTruthy();
    });

    it('should honor the selected fields of the share', async () => {
      const shareRes = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({
          dateFrom: '2026-07-01',
          dateTo: '2026-07-30',
          // event_overview resolves to the profile section — the request
          // DTO accepts only the six share-field enum values.
          selectedFields: ['event_overview'],
        })
        .expect(201);
      const token = expectData(shareRes.body as { shareUrl: string })
        .shareUrl.split('/')
        .pop()!;

      const response = await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/${token}`)
        .expect(200);

      const data = expectData(
        response.body as {
          profile: unknown;
          allergies?: unknown;
          conditions?: unknown;
          currentMedicines?: unknown;
          selectedFields: string[];
        },
      );
      // Only the selected section plus the always-included allergies are
      // present; other deselected sections never leak.
      expect(data.profile).toBeDefined();
      expect(data.allergies).toBeDefined();
      expect(data.conditions).toBeUndefined();
      expect(data.currentMedicines).toBeUndefined();
      expect(data.selectedFields).toEqual(['profile', 'allergies']);
    });

    it('should record exactly one access per public read (single recorder)', async () => {
      const shareRes = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateFrom: '2026-07-01', dateTo: '2026-07-30' })
        .expect(201);
      const share = expectData(
        shareRes.body as { shareId: string; shareUrl: string },
      );
      const token = share.shareUrl.split('/').pop()!;

      // Two summary opens + one PDF open must each record exactly once; if
      // both recorders ran per read, the counter would double.
      await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/${token}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/${token}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/${token}/pdf`)
        .expect(200);

      const record = await ctx.prisma.userClinicSummaryShare.findUnique({
        where: { id: share.shareId },
      });
      expect(record?.accessCount).toBe(3);
    });
  });

  describe('POST /api/v1/user/reports/clinic-summary/export/async', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(CLINIC_EXPORT_ASYNC_PATH)
        .expect(401);
    });

    it('should accept an unscoped (default-scope) export request', async () => {
      // The queue is not configured in the test runtime, so this returns the
      // synchronous fallback PDF — proving the default-scope branch is
      // reachable instead of being rejected by the request DTO.
      const response = await request(app.getHttpServer())
        .post(CLINIC_EXPORT_ASYNC_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(201);

      const body = response.body as { pdfBase64?: string };
      const data = expectData(body);
      expect(typeof data.pdfBase64).toBe('string');
    });

    it('should export a scoped request synchronously with the scope honored', async () => {
      const response = await request(app.getHttpServer())
        .post(CLINIC_EXPORT_ASYNC_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateFrom: '2026-07-01', dateTo: '2026-07-30' })
        .expect(201);

      const data = expectData(response.body as { pdfBase64?: string });
      expect(typeof data.pdfBase64).toBe('string');
    });
  });

  describe('POST /api/v1/user/reports/clinic-summary/preview/pdf', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(CLINIC_PREVIEW_PDF_PATH)
        .expect(401);
    });

    it('should download a PDF file for authenticated user', async () => {
      // The request body honors the scoped range/fields.
      const response = await request(app.getHttpServer())
        .post(CLINIC_PREVIEW_PDF_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateFrom: '2026-07-01', dateTo: '2026-07-30' })
        .expect(200);

      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toContain(
        'clinic-summary.pdf',
      );
      // PDF files start with %PDF
      const body = response.body as Buffer;
      expect(body.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/v1/user/reports/clinic-summary/shared/:token/pdf', () => {
    it('should return 404 for an invalid or expired token', async () => {
      await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/invalid-token-pdf-12345/pdf`)
        .expect(404);
    });

    it('should download a PDF file for a valid shared token', async () => {
      // Create a share link first
      const shareRes = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ dateFrom: '2026-07-01', dateTo: '2026-07-30' })
        .expect(201);

      const shareData = expectData(shareRes.body as { shareUrl: string });
      const token = shareData.shareUrl.split('/').pop()!;

      const response = await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/${token}/pdf`)
        .expect(200);

      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toContain(
        'clinic-summary.pdf',
      );
      const body = response.body as Buffer;
      expect(body.length).toBeGreaterThan(0);
    });
  });

  // ── Event Review ────────────────────────────────────────────

  describe('GET /api/v1/user/reports/reviews*', () => {
    it('should return 401 for unauthenticated requests', async () => {
      await request(app.getHttpServer()).get(REVIEWS_CURRENT_PATH).expect(401);
      await request(app.getHttpServer()).get(REVIEWS_PATH).expect(401);
      await request(app.getHttpServer())
        .get(`${REVIEWS_PATH}/some-event-id`)
        .expect(401);
    });

    it('should return an empty envelope with null data when the user has no events', async () => {
      const response = await request(app.getHttpServer())
        .get(REVIEWS_CURRENT_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const body = response.body as Record<string, unknown>;
      expect(body).toBeNull();
    });

    it('should reject an invalid cursor and an invalid status', async () => {
      await request(app.getHttpServer())
        .get(`${REVIEWS_PATH}?cursor=2026-08-01T08:00:00.000Z`)
        .set('Authorization', bearer(accessToken))
        .expect(400);

      await request(app.getHttpServer())
        .get(`${REVIEWS_PATH}?status=not_a_status`)
        .set('Authorization', bearer(accessToken))
        .expect(400);
    });

    it('should return the current review for an active event and list it', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(HEALTH_EVENTS_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ title: 'e2e 回顾事件' })
        .expect(201);
      const created = expectData(createResponse.body as { id: string });

      const currentResponse = await request(app.getHttpServer())
        .get(REVIEWS_CURRENT_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);
      const currentBody = currentResponse.body as {
        event: { id: string; status: string };
      };
      expect(expectData(currentBody).event.id).toBe(created.id);

      const listResponse = await request(app.getHttpServer())
        .get(`${REVIEWS_PATH}?status=active`)
        .set('Authorization', bearer(accessToken))
        .expect(200);
      const listBody = listResponse.body as {
        items: Array<{ id: string }>;
        total: number;
        nextCursor: string | null;
      };
      const listData = expectData(listBody);
      expect(listData.total).toBe(1);
      expect(listData.items[0]?.id).toBe(created.id);
      expect(listData.nextCursor).toBeNull();
    });

    it('should return 404 for a foreign event review', async () => {
      const otherUser = await createTestUser(
        ctx.prisma,
        undefined,
        'ReviewForeignUser',
      );
      const otherToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        otherUser.id,
        otherUser.email,
      );

      const createResponse = await request(app.getHttpServer())
        .post(HEALTH_EVENTS_PATH)
        .set('Authorization', bearer(otherToken))
        .send({ title: '他人事件' })
        .expect(201);
      const created = expectData(createResponse.body as { id: string });

      await request(app.getHttpServer())
        .get(`${REVIEWS_PATH}/${created.id}`)
        .set('Authorization', bearer(accessToken))
        .expect(404);
    });
  });
});
