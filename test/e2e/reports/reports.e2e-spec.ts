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

const DASHBOARD_PATH = '/api/v1/user/reports/dashboard';
const SUMMARY_GENERATE_PATH = '/api/v1/user/reports/summary/generate';
const SUMMARY_STREAM_PATH = '/api/v1/user/reports/summary/generate/stream';
const CLINIC_PREVIEW_PATH = '/api/v1/user/reports/clinic-summary/preview';
const CLINIC_SHARE_PATH = '/api/v1/user/reports/clinic-summary/share';
const CLINIC_SHARED_PATH = '/api/v1/user/reports/clinic-summary/shared';
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

      const body = response.body as ApiEnvelope<{
        range: string;
        startDate: string;
        endDate: string;
        generatedAt: string;
        score: unknown;
        metrics: unknown;
        aiSummaryEnabled: boolean;
      }>;

      expect(body.code).toBe(ResultCode.SUCCESS);
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

      const data = expectData(response.body as ApiEnvelope<{ range: string }>);
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
        response.body as ApiEnvelope<{
          range: string;
          startDate: string;
          endDate: string;
        }>,
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

      const body = response.body as ApiEnvelope<{ summary?: string }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      expect(body.data).toBeDefined();
    });
  });

  // ── Summary Generate Stream (SSE) ──────────────────────────

  describe('POST /api/v1/user/reports/summary/generate/stream', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).post(SUMMARY_STREAM_PATH).expect(401);
    });

    it('should return 400 when custom range is missing dates', async () => {
      await request(app.getHttpServer())
        .post(SUMMARY_STREAM_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ range: 'custom' })
        .expect(400);
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

    it('should return a de-identified clinic summary for authenticated user', async () => {
      const response = await request(app.getHttpServer())
        .post(CLINIC_PREVIEW_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(201);

      const body = response.body as ApiEnvelope<{
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
      }>;

      expect(body.code).toBe(ResultCode.SUCCESS);
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
  });

  describe('POST /api/v1/user/reports/clinic-summary/share', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).post(CLINIC_SHARE_PATH).expect(401);
    });

    it('should create a shareable link with expiry', async () => {
      const response = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(201);

      const body = response.body as ApiEnvelope<{
        shareUrl: string;
        expiresAt: string;
      }>;

      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.shareUrl).toContain('/clinic-summary/shared/');
      expect(data.expiresAt).toBeTruthy();
      // expiry should be in the future
      expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('GET /api/v1/reports/clinic-summary/shared/:token', () => {
    it('should return 410 for an invalid or expired token', async () => {
      await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/invalid-token-12345`)
        .expect(410);
    });

    it('should return the shared clinic summary for a valid token', async () => {
      // First create a share link
      const shareRes = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(201);

      const shareData = expectData(
        shareRes.body as ApiEnvelope<{ shareUrl: string; expiresAt: string }>,
      );
      // Extract the token from the shareUrl
      const token = shareData.shareUrl.split('/').pop()!;

      // Then access the shared summary
      const response = await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/${token}`)
        .expect(200);

      const body = response.body as ApiEnvelope<{
        generatedAt: string;
        dataRange: string;
        disclaimer: string;
      }>;

      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.generatedAt).toBeTruthy();
      expect(data.dataRange).toBe('last_30_days');
      expect(data.disclaimer).toBeTruthy();
    });
  });

  describe('GET /api/v1/user/reports/clinic-summary/preview/pdf', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(CLINIC_PREVIEW_PDF_PATH)
        .expect(401);
    });

    it('should download a PDF file for authenticated user', async () => {
      const response = await request(app.getHttpServer())
        .get(CLINIC_PREVIEW_PDF_PATH)
        .set('Authorization', bearer(accessToken))
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

  describe('GET /api/v1/reports/clinic-summary/shared/:token/pdf', () => {
    it('should return 410 for an invalid or expired token', async () => {
      await request(app.getHttpServer())
        .get(`${CLINIC_SHARED_PATH}/invalid-token-pdf-12345/pdf`)
        .expect(410);
    });

    it('should download a PDF file for a valid shared token', async () => {
      // Create a share link first
      const shareRes = await request(app.getHttpServer())
        .post(CLINIC_SHARE_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(201);

      const shareData = expectData(
        shareRes.body as ApiEnvelope<{ shareUrl: string }>,
      );
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

      const body = response.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.SUCCESS);
      expect(body.data).toBeNull();
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
      const created = expectData(
        createResponse.body as ApiEnvelope<{ id: string }>,
      );

      const currentResponse = await request(app.getHttpServer())
        .get(REVIEWS_CURRENT_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);
      const currentBody = currentResponse.body as ApiEnvelope<{
        event: { id: string; status: string };
      }>;
      expect(currentBody.code).toBe(ResultCode.SUCCESS);
      expect(expectData(currentBody).event.id).toBe(created.id);

      const listResponse = await request(app.getHttpServer())
        .get(`${REVIEWS_PATH}?status=active`)
        .set('Authorization', bearer(accessToken))
        .expect(200);
      const listBody = listResponse.body as ApiEnvelope<{
        items: Array<{ id: string }>;
        total: number;
        nextCursor: string | null;
      }>;
      expect(listBody.code).toBe(ResultCode.SUCCESS);
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
      const created = expectData(
        createResponse.body as ApiEnvelope<{ id: string }>,
      );

      await request(app.getHttpServer())
        .get(`${REVIEWS_PATH}/${created.id}`)
        .set('Authorization', bearer(accessToken))
        .expect(404);
    });
  });
});
