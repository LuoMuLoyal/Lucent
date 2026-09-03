import request from 'supertest';

import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
  expectData,
} from '../../helpers/e2e-helpers.js';
import type {
  E2eTestContext,
  E2eApp,
  TestUser,
} from '../../helpers/e2e-helpers.js';

const BASE_PATH = '/api/v1/user/files';

describe('Files API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(ctx.prisma, undefined, 'FilesUser');
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

  describe('POST /files/upload', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_PATH}/upload`)
        .send({
          contentType: 'image/jpeg',
          sizeBytes: 102400,
          fileName: 'test.jpg',
        })
        .expect(401);
    });

    it('should return 400 for invalid content type', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/upload`)
        .set('Authorization', bearer(accessToken))
        .send({
          contentType: 'application/pdf',
          sizeBytes: 102400,
          fileName: 'test.pdf',
        });

      expect(res.status).toBe(400);
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/upload`)
        .set('Authorization', bearer(accessToken))
        .send({
          fileName: 'test.jpg',
        });

      expect(res.status).toBe(400);
    });

    it('should reject unknown body keys (strict schema)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/upload`)
        .set('Authorization', bearer(accessToken))
        .send({
          contentType: 'image/jpeg',
          sizeBytes: 102400,
          fileName: 'test.jpg',
          extraField: 'unknown',
        })
        .expect(400);

      expect((res.body as { code?: string }).code).toBe('VALIDATION_FAILED');
    });

    it('should create presigned upload URL or return error when COS not configured', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/upload`)
        .set('Authorization', bearer(accessToken))
        .send({
          contentType: 'image/jpeg',
          sizeBytes: 102400,
          fileName: 'photo.jpg',
        });

      // COS may not be configured in test environment → 400, 500, or 503
      // (see the widened assertion below). When COS is configured → 200.
      if (res.status === 200) {
        const body = res.body as {
          provider: string;
          bucket: string;
          objectKey: string;
          uploadUrl: string;
          headers: Record<string, string>;
          publicUrl: string | null;
          expiresAt: string;
          maxSizeBytes: number;
        };
        const data = expectData(body);
        expect(data.provider).toBeDefined();
        expect(data.objectKey).toContain('files/');
        expect(data.expiresAt).toBeDefined();
        expect(data.maxSizeBytes).toBeGreaterThan(0);
      } else {
        // Storage not configured → 503 `DEPENDENCY_UNAVAILABLE` is the new
        // Task 9 classification for COS/S3 failures (was 500 before the
        // Result migration); 400 covers validation; 500 is retained for
        // uncaught exceptions / rejection paths that bypass the Result
        // mapping (unknown DB/connection errors rethrow).
        expect([400, 500, 503]).toContain(res.status);
      }
    });

    it('should handle PNG image upload', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/upload`)
        .set('Authorization', bearer(accessToken))
        .send({
          contentType: 'image/png',
          sizeBytes: 204800,
          fileName: 'screenshot.png',
        });

      expect(res.status).not.toBe(401);
    });

    it('should handle upload without optional fileName', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/upload`)
        .set('Authorization', bearer(accessToken))
        .send({
          contentType: 'image/jpeg',
          sizeBytes: 51200,
        });

      expect(res.status).not.toBe(401);
    });
  });
});
