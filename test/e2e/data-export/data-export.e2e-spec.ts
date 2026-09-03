import request from 'supertest';
import {
  createTestApp,
  cleanupDatabase,
  registerTestUser,
  bearer,
  expectData,
} from '../../helpers/e2e-helpers.js';
import type {
  E2eTestContext,
  E2eApp,
  RegisteredTestUser,
} from '../../helpers/e2e-helpers.js';

const EXPORT_PATH = '/api/v1/user/data-export-requests';
const TEST_PASSWORD = 'Test@123456';

describe('Data Export API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: RegisteredTestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await registerTestUser(ctx, undefined, TEST_PASSWORD, 'ExportUser');
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  describe('POST /api/v1/user/data-export-requests', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).post(EXPORT_PATH).expect(401);
    });

    it('should reject a request without password re-authentication', async () => {
      await request(app.getHttpServer())
        .post(EXPORT_PATH)
        .set('Authorization', bearer(user.accessToken))
        .send({})
        .expect(400);
    });

    it('should reject an invalid kind enum value', async () => {
      const res = await request(app.getHttpServer())
        .post(EXPORT_PATH)
        .set('Authorization', bearer(user.accessToken))
        .send({ password: TEST_PASSWORD, kind: 'weekly' })
        .expect(400);

      expect((res.body as { code?: string }).code).toBe('VALIDATION_FAILED');
    });

    it('should reject unknown body keys (strict schema)', async () => {
      const res = await request(app.getHttpServer())
        .post(EXPORT_PATH)
        .set('Authorization', bearer(user.accessToken))
        .send({ password: TEST_PASSWORD, extraField: 'x' })
        .expect(400);

      expect((res.body as { code?: string }).code).toBe('VALIDATION_FAILED');
    });

    it('should create a data export request with default values', async () => {
      const response = await request(app.getHttpServer())
        .post(EXPORT_PATH)
        .set('Authorization', bearer(user.accessToken))
        .send({ password: TEST_PASSWORD })
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

      // Verify audit log was written
      const auditLog = await ctx.prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          action: 'data_export.request',
          resourceId: data.id,
        },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog!.resourceType).toBe('data_export');
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
        .set('Authorization', bearer(user.accessToken))
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
