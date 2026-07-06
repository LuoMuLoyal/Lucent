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

const NOTIFICATIONS_PATH = '/api/v1/user/notifications';

describe('Notifications API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(ctx.prisma, undefined, 'NotifUser');
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

  it('should return 401 for unauthenticated request', async () => {
    await request(app.getHttpServer()).get(NOTIFICATIONS_PATH).expect(401);
  });

  it('should list notifications (empty for new user)', async () => {
    const response = await request(app.getHttpServer())
      .get(NOTIFICATIONS_PATH)
      .set('Authorization', bearer(accessToken))
      .expect(200);

    const body = response.body as ApiEnvelope<{
      items: unknown[];
      total: number;
    }>;
    expect(body.code).toBe(0);
    const data = expectData(body);
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('should create a notification and return it', async () => {
    const response = await request(app.getHttpServer())
      .post(NOTIFICATIONS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({
        type: 'system_announcement',
        title: 'Test notification',
        content: 'This is a test notification content.',
      })
      .expect(201);

    const data = expectData(
      response.body as ApiEnvelope<{ id: string; type: string; title: string }>,
    );
    expect(data.id).toBeTruthy();
    expect(data.title).toBe('Test notification');
    expect(data.type).toBe('system_announcement');
  });

  it('should return unread count greater than zero after creation', async () => {
    const response = await request(app.getHttpServer())
      .get(`${NOTIFICATIONS_PATH}/unread-count`)
      .set('Authorization', bearer(accessToken))
      .expect(200);

    const body = response.body as ApiEnvelope<{ count: number }>;
    expect(body.code).toBe(0);
    const data = expectData(body);
    expect(data.count).toBeGreaterThanOrEqual(1);
  });

  it('should mark all notifications as read and verify unread count is zero', async () => {
    const response = await request(app.getHttpServer())
      .patch(`${NOTIFICATIONS_PATH}/mark-all-read`)
      .set('Authorization', bearer(accessToken))
      .expect(200);

    const body = response.body as ApiEnvelope<{ count: number }>;
    expect(body.code).toBe(0);
    const data = expectData(body);
    expect(data.count).toBeGreaterThanOrEqual(1);

    // Verify unread count is now 0
    const unreadRes = await request(app.getHttpServer())
      .get(`${NOTIFICATIONS_PATH}/unread-count`)
      .set('Authorization', bearer(accessToken));

    const unreadBody = unreadRes.body as ApiEnvelope<{ count: number }>;
    expect(unreadBody.data?.count).toBe(0);
  });
});
