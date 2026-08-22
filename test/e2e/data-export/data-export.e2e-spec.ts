import request from 'supertest';
import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
  createSecurityElevationToken,
  expectData,
  SECURITY_ELEVATION_HEADER,
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
  let elevationToken: string;

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
    elevationToken = await createSecurityElevationToken(ctx, user.id);
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
        .set(SECURITY_ELEVATION_HEADER, bearer(elevationToken))
        .send({})
        .expect(201);

      const data = expectData(
        response.body as {
          id: string;
          kind: string;
          format: string;
          status: string;
          createdAt: string;
        },
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
        .set(SECURITY_ELEVATION_HEADER, bearer(elevationToken))
        .expect(200);

      const data = expectData(
        response.body as {
          id: string;
          kind: string;
          status: string;
          createdAt: string;
        } | null,
      );
      expect(data).not.toBeNull();
      expect(data?.kind).toBe('hospital');
    });
  });
});
