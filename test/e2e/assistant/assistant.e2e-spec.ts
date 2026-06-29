import request from 'supertest';

import type { ApiEnvelope } from '../../../src/common/api-envelope';
import { ResultCode } from '../../../src/common/api-envelope';
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

const BASE_PATH = '/api/v1/user/assistant';

describe('Assistant API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(ctx.prisma, undefined, 'AstUser');
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

  describe('GET /capabilities', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}/capabilities`)
        .expect(401);
    });

    it('should return assistant capabilities for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_PATH}/capabilities`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      expect((res.body as ApiEnvelope).code).toBe(ResultCode.SUCCESS);
    });
  });

  describe('GET /conversations', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}/conversations`)
        .expect(401);
    });

    it('should list conversations (empty for new user)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_PATH}/conversations`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      expect((res.body as ApiEnvelope).code).toBe(ResultCode.SUCCESS);
    });
  });

  describe('GET /latest', () => {
    it('should return latest conversation or null for new user', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_PATH}/latest`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const body = res.body as ApiEnvelope<{ id?: string }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
    });
  });
});
