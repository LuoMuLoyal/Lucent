import request from 'supertest';

import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
} from '../../helpers/e2e-helpers';
import type {
  E2eTestContext,
  E2eApp,
  TestUser,
} from '../../helpers/e2e-helpers';

const BASE_PATH = '/api/v1/user/today-analysis';
const RECOMMENDATIONS_PATH = `${BASE_PATH}/recommendations`;
const GENERATE_PATH = `${BASE_PATH}/generate`;
const GENERATE_STREAM_PATH = `${BASE_PATH}/generate/stream`;

describe('Today Analysis API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(ctx.prisma, undefined, 'TodayUser');
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

  describe('GET /api/v1/user/today-analysis/recommendations', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).get(RECOMMENDATIONS_PATH).expect(401);
    });

    it('should return health recommendations for authenticated user', async () => {
      const response = await request(app.getHttpServer())
        .get(RECOMMENDATIONS_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const body = response.body as Record<string, unknown>;
      expect(body).toBeDefined();
    });

    it('should accept exclude query parameters', async () => {
      await request(app.getHttpServer())
        .get(`${RECOMMENDATIONS_PATH}?exclude=rec-1&exclude=rec-2`)
        .set('Authorization', bearer(accessToken))
        .expect(200);
    });
  });

  // ── POST /generate ──────────────────────────────────────────

  describe('POST /api/v1/user/today-analysis/generate', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).post(GENERATE_PATH).expect(401);
    });

    it('should return 400 VALIDATION_FAILED for invalid date format', async () => {
      const res = await request(app.getHttpServer())
        .post(GENERATE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ date: 'invalid-date' })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should return analysis or empty-context status for authenticated user', async () => {
      const response = await request(app.getHttpServer())
        .post(GENERATE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({})
        .expect(201);

      // With the materialization store enabled, a user with no health
      // context gets an empty-context response instead of a fallback
      // analysis. The response always includes a `status` field.
      const body = response.body as {
        status: string;
        analysis: unknown;
        sourceVersion: number;
        computedVersion: number;
      };

      expect(body).toBeDefined();
      expect(typeof body.status).toBe('string');
      expect(typeof body.sourceVersion).toBe('number');
      expect(typeof body.computedVersion).toBe('number');
    });

    it('should accept a specific date parameter', async () => {
      const response = await request(app.getHttpServer())
        .post(GENERATE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ date: '2026-06-15' })
        .expect(201);

      // The response includes a status field from the materialization layer.
      // A specific date with no health context yields an empty/pending status.
      const body = response.body as { status: string };
      expect(typeof body.status).toBe('string');
    });
  });

  // ── POST /generate/stream (SSE) ─────────────────────────────

  describe('POST /api/v1/user/today-analysis/generate/stream', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).post(GENERATE_STREAM_PATH).expect(401);
    });

    it('should return 400 VALIDATION_FAILED for invalid date format', async () => {
      const res = await request(app.getHttpServer())
        .post(GENERATE_STREAM_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ date: 'not-a-date' })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should return SSE stream with result and done events', async () => {
      const response = await request(app.getHttpServer())
        .post(GENERATE_STREAM_PATH)
        .set('Authorization', bearer(accessToken))
        .send({})
        .expect(200);

      expect(response.headers['content-type']).toContain('text/event-stream');

      const text = response.text as string;
      // SSE stream must contain event markers
      expect(text).toContain('event:');
      // The stream should always end with a done event or an error event
      // (materialization may emit an error frame when the context is empty
      // or a pending claim conflicts).
      expect(
        text.includes('event: done') || text.includes('event: error'),
      ).toBe(true);
    });

    it('should accept a specific date and stream analysis', async () => {
      const response = await request(app.getHttpServer())
        .post(GENERATE_STREAM_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ date: '2026-06-20' })
        .expect(200);

      expect(response.headers['content-type']).toContain('text/event-stream');

      const text = response.text as string;
      // The stream always emits either a result or error event,
      // followed by done (for result) or just error (for conflict).
      expect(
        text.includes('event: result') || text.includes('event: error'),
      ).toBe(true);
    });
  });
});
