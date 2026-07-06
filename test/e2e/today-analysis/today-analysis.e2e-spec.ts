import request from 'supertest';

import type { ApiEnvelope } from '../../../src/common/api';
import { ResultCode } from '../../../src/common/api';
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

const RECOMMENDATIONS_PATH = '/api/v1/user/today-analysis/recommendations';

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
});
