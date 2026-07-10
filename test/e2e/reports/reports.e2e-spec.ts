import request from 'supertest';

import type { ApiEnvelope } from '../../../src/common/api';
import { ResultCode } from '../../../src/common/api';
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
const CLINIC_PREVIEW_PATH = '/api/v1/user/reports/clinic-summary/preview';
const CLINIC_SHARE_PATH = '/api/v1/user/reports/clinic-summary/share';
const CLINIC_SHARED_PATH = '/api/v1/user/reports/clinic-summary/shared';
const CLINIC_PREVIEW_PDF_PATH =
  '/api/v1/user/reports/clinic-summary/preview/pdf';

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
        .post('/api/v1/user/reports/summary/generate')
        .set('Authorization', bearer(accessToken))
        .send({ range: 'last_7_days' })
        .expect(201);

      const body = response.body as ApiEnvelope<{ summary?: string }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      expect(body.data).toBeDefined();
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
});
