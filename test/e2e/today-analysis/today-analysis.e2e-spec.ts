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

      const body = response.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.SUCCESS);
      expect(body.data).toBeDefined();
    });

    it('should accept exclude query parameters', async () => {
      const response = await request(app.getHttpServer())
        .get(`${RECOMMENDATIONS_PATH}?exclude=rec-1&exclude=rec-2`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      expect((response.body as ApiEnvelope).code).toBe(ResultCode.SUCCESS);
    });
  });

  // ── POST /generate ──────────────────────────────────────────

  describe('POST /api/v1/user/today-analysis/generate', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).post(GENERATE_PATH).expect(401);
    });

    it('should return 400 for invalid date format', async () => {
      await request(app.getHttpServer())
        .post(GENERATE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ date: 'invalid-date' })
        .expect(400);
    });

    it('should generate today analysis for authenticated user (may be fallback)', async () => {
      const response = await request(app.getHttpServer())
        .post(GENERATE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({})
        .expect(201);

      const body = response.body as ApiEnvelope<{
        date: string;
        generatedAt: string;
        summary: string;
        bullets: Array<{ text: string }>;
        actionLabel: string;
        action: string;
        confidenceNote: string;
      }>;

      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.date).toBeTruthy();
      expect(data.generatedAt).toBeTruthy();
      expect(typeof data.summary).toBe('string');
      expect(data.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(data.bullets)).toBe(true);
      expect(typeof data.actionLabel).toBe('string');
      expect(typeof data.action).toBe('string');
    });

    it('should accept a specific date parameter', async () => {
      const response = await request(app.getHttpServer())
        .post(GENERATE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ date: '2026-06-15' })
        .expect(201);

      const body = response.body as ApiEnvelope<{ date: string }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      expect(body.data?.date).toBe('2026-06-15');
    });
  });

  // ── POST /generate/stream (SSE) ─────────────────────────────

  describe('POST /api/v1/user/today-analysis/generate/stream', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).post(GENERATE_STREAM_PATH).expect(401);
    });

    it('should return 400 for invalid date format', async () => {
      await request(app.getHttpServer())
        .post(GENERATE_STREAM_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ date: 'not-a-date' })
        .expect(400);
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
      // The stream should always end with a done event
      expect(text).toContain('event: done');
      // A result event should be present with analysis data
      expect(text).toContain('event: result');
      // The result data should contain analysis fields
      expect(text).toContain('"summary"');
      expect(text).toContain('"date"');
      expect(text).toContain('"generatedAt"');
    });

    it('should accept a specific date and stream analysis', async () => {
      const response = await request(app.getHttpServer())
        .post(GENERATE_STREAM_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ date: '2026-06-20' })
        .expect(200);

      expect(response.headers['content-type']).toContain('text/event-stream');

      const text = response.text as string;
      expect(text).toContain('event: result');
      expect(text).toContain('event: done');
      expect(text).toContain('"2026-06-20"');
    });
  });
});
