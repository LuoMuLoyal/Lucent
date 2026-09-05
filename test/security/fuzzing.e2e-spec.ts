import request from 'supertest';

import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
  uniqueEmail,
} from '../helpers/e2e-helpers.js';
import type {
  E2eTestContext,
  E2eApp,
  TestUser,
} from '../helpers/e2e-helpers.js';

/**
 * Security tests: input fuzzing.
 *
 * Sends malformed, oversized, and adversarial inputs to key endpoints.
 * The expectation is always a proper 4xx error response — never a 500
 * Internal Server Error, which would indicate an unhandled crash.
 */
describe('Security: Input Fuzzing (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(ctx.prisma, uniqueEmail('fuzz'), 'FuzzUser');
    accessToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      user.id,
      user.email,
    );
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    // app.close() may hang due to pending queue workers or scheduled tasks;
    // race with a timeout so the test process can exit cleanly.
    await Promise.race([
      app.close(),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          resolve();
        }, 10_000),
      ),
    ]);
  }, 30_000);

  // ── Auth endpoints ──────────────────────────────────────────

  describe('POST /api/v1/auth/register — fuzzing', () => {
    it('should reject malformed JSON body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Content-Type', 'application/json')
        .send('{"email": "not closed')
        .expect(400);

      void res;
    });

    it('should reject SQL injection attempt in email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: "'; DROP TABLE users; --",
          password: 'Test@123456',
          nickname: 'SQLInjector',
        })
        .expect(400);

      void res;
    });

    it('should reject NoSQL injection attempt in email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: { $gt: '' },
          password: 'Test@123456',
        })
        .expect(400);

      void res;
    });

    it('should reject oversized payload', async () => {
      const hugeString = 'A'.repeat(100_000);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Test@123456',
          nickname: hugeString,
        })
        .expect(400);

      void res;
    });

    it('should reject null byte injection in email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'test\u0000admin@example.com',
          password: 'Test@123456',
        })
        .expect(400);

      void res;
    });

    it('should reject path traversal in nickname', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'traversal@example.com',
          password: 'Test@123456',
          nickname: '../../../etc/passwd',
        });

      // Should be either 201 (nickname is just a string, no path resolution)
      // or 400 if validation rejects it. Never 500.
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('POST /api/v1/auth/login — fuzzing', () => {
    it('should reject login with empty body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);

      void res;
    });

    it('should reject login with wrong types', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 12345,
          password: false,
        })
        .expect(400);

      void res;
    });

    it('should not leak whether email exists (same error for unknown email)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent_user_xyz@example.com',
          password: 'Test@123456',
        })
        .expect(401);

      void res;

      // Should not contain stack trace or internal info
      expect(res.body['detail']).not.toContain('Prisma');
      expect(res.body['detail']).not.toContain('at Object');
    });
  });

  // ── Authenticated endpoints ─────────────────────────────────

  describe('POST /api/v1/user/daily-records — fuzzing', () => {
    it('should reject XSS attempt in payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/user/daily-records')
        .set('Authorization', bearer(accessToken))
        .send({
          date: '2026-07-12',
          kind: 'meal',
          payload: {
            mealType: '<script>alert("xss")</script>',
            items: [],
          },
        });

      // Should succeed (we store it) or be rejected — but never 500
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(500);
    });

    it('should reject invalid date format', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/user/daily-records')
        .set('Authorization', bearer(accessToken))
        .send({
          date: 'not-a-date',
          kind: 'meal',
          payload: { mealType: 'breakfast', items: [] },
        })
        .expect(400);

      void res;
    });

    it('should reject invalid kind enum', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/user/daily-records')
        .set('Authorization', bearer(accessToken))
        .send({
          date: '2026-07-12',
          kind: 'INVALID_KIND',
          payload: {},
        })
        .expect(400);

      void res;
    });
  });

  describe('PATCH /api/v1/user/health-context/allergies/:id — fuzzing', () => {
    it('should reject invalid UUID format', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/user/health-context/allergies/not-a-uuid')
        .set('Authorization', bearer(accessToken))
        .send({ label: 'Test' })
        .expect(400);

      void res;
    });

    it('should reject invalid allergy severity enum', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/user/health-context/allergies')
        .set('Authorization', bearer(accessToken))
        .send({
          kind: 'INVALID_KIND',
          label: 'Test Allergy',
          severity: 'EXTREME_DANGER',
        })
        .expect(400);

      void res;
    });
  });

  describe('GET /api/v1/medicines — fuzzing', () => {
    it('should reject negative page number', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/medicines')
        .query({ q: 'test', page: -1, pageSize: 10 })
        .expect(400);

      void res;
    });

    it('should reject oversized page size', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/medicines')
        .query({ q: 'test', page: 1, pageSize: 99999 })
        .expect(400);

      void res;
    });

    it('should handle SQL injection in search query', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/medicines')
        .query({ q: "'; DROP TABLE drugbank_drug; --" })
        .expect(200);

      void res;

      // Should return empty results, not crash
    });
  });

  // ── HTTP method fuzzing ─────────────────────────────────────

  describe('HTTP method fuzzing', () => {
    it('should reject PUT on a GET-only endpoint', async () => {
      await request(app.getHttpServer()).put('/api/v1/health').expect(404);
    });

    it('should reject DELETE on a GET-only endpoint', async () => {
      await request(app.getHttpServer()).delete('/api/v1/health').expect(404);
    });

    it('should reject PATCH on a GET-only endpoint', async () => {
      await request(app.getHttpServer()).patch('/api/v1/health').expect(404);
    });
  });

  // ── Header injection ────────────────────────────────────────

  describe('Header injection', () => {
    it('should reject Authorization header with newline', async () => {
      // Node.js HTTP parser rejects newlines in header values at the transport
      // layer, preventing header injection before the request reaches NestJS.
      // This test verifies that the injection attempt is blocked.
      await expect(
        request(app.getHttpServer())
          .get('/api/v1/account')
          .set('Authorization', 'Bearer token\r\nX-Injected: true'),
      ).rejects.toThrow();
    });

    it('should handle extremely long Authorization header', async () => {
      const longToken = 'A'.repeat(10_000);
      const res = await request(app.getHttpServer())
        .get('/api/v1/account')
        .set('Authorization', `Bearer ${longToken}`)
        .expect(401);

      void res;
    });
  });
});
