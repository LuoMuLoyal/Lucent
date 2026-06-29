import request from 'supertest';
import type { ApiEnvelope } from '../../../src/common/api-envelope';
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

const EXPORT_PATH = '/api/v1/user/data-export-requests';

describe('Data Export API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(ctx.prisma, undefined, 'ExportUser');
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

  describe('POST /api/v1/user/data-export-requests', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).post(EXPORT_PATH).expect(401);
    });

    it('should create a data export request with default values', async () => {
      const response = await request(app.getHttpServer())
        .post(EXPORT_PATH)
        .set('Authorization', bearer(accessToken))
        .send({})
        .expect(201);

      const data = expectData(
        response.body as ApiEnvelope<{
          id: string;
          kind: string;
          format: string;
          status: string;
          createdAt: string;
        }>,
      );
      expect(data.id).toBeTruthy();
      expect(data.kind).toBe('hospital');
      expect(data.format).toBe('pdf');
      expect(data.status).toBeTruthy();
    });
  });

  describe('GET /api/v1/user/data-export-requests/latest', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`${EXPORT_PATH}/latest`)
        .expect(401);
    });

    it('should return the latest export request for authenticated user', async () => {
      const response = await request(app.getHttpServer())
        .get(`${EXPORT_PATH}/latest`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const data = expectData(
        response.body as ApiEnvelope<{
          id: string;
          kind: string;
          status: string;
          createdAt: string;
        } | null>,
      );
      expect(data).not.toBeNull();
      expect(data?.kind).toBe('hospital');
    });
  });
});
