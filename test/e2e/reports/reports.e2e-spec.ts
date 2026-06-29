import request from 'supertest';

import type { ApiEnvelope } from '../../../src/common/api-envelope';
import { ResultCode } from '../../../src/common/api-envelope';
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
});
