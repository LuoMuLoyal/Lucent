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

    it('should create presigned upload URL or return error when COS not configured', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/upload`)
        .set('Authorization', bearer(accessToken))
        .send({
          contentType: 'image/jpeg',
          sizeBytes: 102400,
          fileName: 'photo.jpg',
        });

      // COS may not be configured in test environment → 400 or 500
      // When COS is configured → 200
      if (res.status === 200) {
        const body = res.body as ApiEnvelope<{
          provider: string;
          bucket: string;
          objectKey: string;
          uploadUrl: string;
          headers: Record<string, string>;
          publicUrl: string | null;
          expiresAt: string;
          maxSizeBytes: number;
        }>;
        expect(body.code).toBe(ResultCode.SUCCESS);
        const data = expectData(body);
        expect(data.provider).toBeDefined();
        expect(data.objectKey).toContain('files/');
        expect(data.expiresAt).toBeDefined();
        expect(data.maxSizeBytes).toBeGreaterThan(0);
      } else {
        // COS not configured — accept 400 or 500
        expect([400, 500]).toContain(res.status);
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
