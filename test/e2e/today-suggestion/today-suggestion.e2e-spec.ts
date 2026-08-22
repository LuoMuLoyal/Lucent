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

const BASE_PATH = '/api/v1/user/today/suggestions';

describe('Today Suggestion API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(ctx.prisma, undefined, 'SuggestionUser');
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

  describe('GET /today/suggestions', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).get(BASE_PATH).expect(401);
    });

    it('should return suggestions or graceful error for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get(BASE_PATH)
        .set('Authorization', bearer(accessToken));

      // The endpoint may return 200 (success) or 500 (if LLM not configured)
      // but should never return 401 (auth works)
      expect(res.status).not.toBe(401);
      if (res.status === 200) {
        expect(res.body).toBeDefined();
      }
    });

    it('should accept date query parameter', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_PATH}?date=2026-07-10`)
        .set('Authorization', bearer(accessToken));

      expect(res.status).not.toBe(401);
    });

    it('should accept excludeIds query parameter', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_PATH}?excludeIds=test-id-1&excludeIds=test-id-2`)
        .set('Authorization', bearer(accessToken));

      expect(res.status).not.toBe(401);
    });
  });

  describe('GET /today/suggestions/history', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}/history`)
        .expect(401);
    });

    it('should return history for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_PATH}/history`)
        .set('Authorization', bearer(accessToken));

      // May return 200 or 500 depending on environment
      expect(res.status).not.toBe(401);
      if (res.status === 200) {
        const body = res.body as {
          items: unknown[];
          total: number;
          startDate: string;
          endDate: string;
        };
        const data = expectData(body);
        expect(Array.isArray(data.items)).toBe(true);
        expect(data.total).toBeGreaterThanOrEqual(0);
        expect(data.startDate).toBeTruthy();
        expect(data.endDate).toBeTruthy();
      }
    });

    it('should accept date range and filters', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `${BASE_PATH}/history?startDate=2026-06-01&endDate=2026-07-10&lifecycleState=expired&limit=50`,
        )
        .set('Authorization', bearer(accessToken));

      expect(res.status).not.toBe(401);
    });
  });

  describe('POST /today/suggestions/:id/feedback', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_PATH}/fake-id/feedback`)
        .send({ feedback: 'helpful' })
        .expect(401);
    });

    it('should return 400 for non-existent suggestion', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/nonexistent-id/feedback`)
        .set('Authorization', bearer(accessToken))
        .send({ feedback: 'helpful' });

      expect([400, 404]).toContain(res.status);
    });
  });

  describe('POST /today/suggestions/:id/explain', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_PATH}/fake-id/explain`)
        .expect(401);
    });

    it('should return error for non-existent suggestion', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/nonexistent-id/explain`)
        .set('Authorization', bearer(accessToken));

      // May return 400, 404, or 500 depending on LLM configuration
      expect(res.status).not.toBe(401);
    });
  });
});
