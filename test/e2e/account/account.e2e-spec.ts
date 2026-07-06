import request from 'supertest';
import type { ApiEnvelope } from '../../../src/common/api';
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

const ACCOUNT_PATH = '/api/v1/account';

describe('Account API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(ctx.prisma, undefined, 'AccountUser');
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

  describe('GET /api/v1/account', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).get(ACCOUNT_PATH).expect(401);
    });

    it('should return account profile for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get(ACCOUNT_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const data = expectData(
        res.body as ApiEnvelope<{
          id: string;
          email: string;
          nickname: string;
          hasPassword: boolean;
        }>,
      );
      expect(data.id).toBe(user.id);
      expect(data.email).toBe(user.email);
      expect(data.nickname).toBe('AccountUser');
      expect(data.hasPassword).toBe(true);
    });
  });

  describe('PATCH /api/v1/account', () => {
    it('should update nickname successfully', async () => {
      const res = await request(app.getHttpServer())
        .patch(ACCOUNT_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ nickname: 'UpdatedName' })
        .expect(200);

      const data = expectData(res.body as ApiEnvelope<{ nickname: string }>);
      expect(data.nickname).toBe('UpdatedName');
    });

    it('should normalize empty string nickname to null', async () => {
      const res = await request(app.getHttpServer())
        .patch(ACCOUNT_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ nickname: '' })
        .expect(200);

      const data = expectData(
        res.body as ApiEnvelope<{ nickname: string | null }>,
      );
      expect(data.nickname).toBeNull();
    });

    it('should reject unauthenticated update request', async () => {
      await request(app.getHttpServer())
        .patch(ACCOUNT_PATH)
        .send({ nickname: 'Hacker' })
        .expect(401);
    });
  });
});
