import request from 'supertest';
import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
  expectData,
  uniqueEmail,
} from '../../helpers/e2e-helpers.js';
import type {
  E2eTestContext,
  E2eApp,
  TestUser,
} from '../../helpers/e2e-helpers.js';
import { UserStatus } from '#generated/prisma/client.js';

const NOTIFICATIONS_PATH = '/api/v1/user/notifications';

// ── Types ─────────────────────────────────────────────────────

interface NotificationDetail {
  id: string;
  type: string;
  title: string;
  content: string;
  action: string | null;
  actionPayload: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────

async function createNotification(
  app: E2eApp,
  token: string,
  overrides: Partial<{
    type: string;
    title: string;
    content: string;
    action: string;
    actionPayload: Record<string, unknown>;
  }> = {},
): Promise<NotificationDetail> {
  const body: Record<string, unknown> = {
    type: overrides.type ?? 'medicine_reminder',
    title: overrides.title ?? 'Test notification',
    content: overrides.content ?? 'Test content body.',
  };
  if (overrides.action !== undefined) body['action'] = overrides.action;
  if (overrides.actionPayload !== undefined)
    body['actionPayload'] = overrides.actionPayload;

  const res = await request(app.getHttpServer())
    .post(NOTIFICATIONS_PATH)
    .set('Authorization', bearer(token))
    .send(body)
    .expect(201);

  return expectData(res.body as NotificationDetail);
}

// ── Test Suite ───────────────────────────────────────────────

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

  // ════════════════════════════════════════════════════════════
  // Existing tests: list + create + unread-count + mark-all-read
  // ════════════════════════════════════════════════════════════

  it('should return 401 for unauthenticated list request', async () => {
    await request(app.getHttpServer()).get(NOTIFICATIONS_PATH).expect(401);
  });

  it('should list notifications (empty for new user)', async () => {
    const response = await request(app.getHttpServer())
      .get(NOTIFICATIONS_PATH)
      .set('Authorization', bearer(accessToken))
      .expect(200);

    const body = response.body as {
      items: unknown[];
      total: number;
    };
    const data = expectData(body);
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('should create a notification and return it', async () => {
    const response = await request(app.getHttpServer())
      .post(NOTIFICATIONS_PATH)
      .set('Authorization', bearer(accessToken))
      .send({
        type: 'medicine_reminder',
        title: 'Test notification',
        content: 'This is a test notification content.',
      })
      .expect(201);

    const data = expectData(
      response.body as { id: string; type: string; title: string },
    );
    expect(data.id).toBeTruthy();
    expect(data.title).toBe('Test notification');
    expect(data.type).toBe('medicine_reminder');
  });

  it('should return unread count greater than zero after creation', async () => {
    const response = await request(app.getHttpServer())
      .get(`${NOTIFICATIONS_PATH}/unread-count`)
      .set('Authorization', bearer(accessToken))
      .expect(200);

    const body = response.body as { count: number };
    const data = expectData(body);
    expect(data.count).toBeGreaterThanOrEqual(1);
  });

  it('should mark all notifications as read and verify unread count is zero', async () => {
    const response = await request(app.getHttpServer())
      .patch(`${NOTIFICATIONS_PATH}/mark-all-read`)
      .set('Authorization', bearer(accessToken))
      .expect(200);

    const body = response.body as { count: number };
    const data = expectData(body);
    expect(data.count).toBeGreaterThanOrEqual(1);

    // Verify unread count is now 0
    const unreadRes = await request(app.getHttpServer())
      .get(`${NOTIFICATIONS_PATH}/unread-count`)
      .set('Authorization', bearer(accessToken));

    const unreadBody = unreadRes.body as { count: number };
    expect(unreadBody.count).toBe(0);
  });

  // ════════════════════════════════════════════════════════════
  // GET /notifications/:id — detail
  // ════════════════════════════════════════════════════════════

  describe('GET /notifications/:id', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`${NOTIFICATIONS_PATH}/fake-id`)
        .expect(401);
    });

    it('should return notification detail for an existing id', async () => {
      const created = await createNotification(app, accessToken, {
        title: 'Detail test',
        content: 'Detail content body.',
      });

      const res = await request(app.getHttpServer())
        .get(`${NOTIFICATIONS_PATH}/${created.id}`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const data = expectData(res.body as NotificationDetail);
      expect(data.id).toBe(created.id);
      expect(data.title).toBe('Detail test');
      expect(data.content).toBe('Detail content body.');
      expect(data.isRead).toBe(false);
      expect(data.readAt).toBeNull();
      expect(data.createdAt).toBeTruthy();
    });

    it('should return 404 for a non-existent id', async () => {
      await request(app.getHttpServer())
        .get(`${NOTIFICATIONS_PATH}/nonexistent-id`)
        .set('Authorization', bearer(accessToken))
        .expect(404);
    });

    it('should not return a notification belonging to another user', async () => {
      // Create notification for the main user
      const created = await createNotification(app, accessToken, {
        title: 'Owner only',
      });

      // Create a second user + token
      const otherEmail = uniqueEmail('notif-other');
      const otherUser = await ctx.prisma.user.create({
        data: {
          email: otherEmail,
          status: UserStatus.active,
        },
      });
      const otherToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        otherUser.id,
        otherUser.email!,
      );

      await request(app.getHttpServer())
        .get(`${NOTIFICATIONS_PATH}/${created.id}`)
        .set('Authorization', bearer(otherToken))
        .expect(404);
    });
  });

  // ════════════════════════════════════════════════════════════
  // PATCH /notifications/:id/read — mark as read
  // ════════════════════════════════════════════════════════════

  describe('PATCH /notifications/:id/read', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .patch(`${NOTIFICATIONS_PATH}/fake-id/read`)
        .expect(401);
    });

    it('should mark an unread notification as read', async () => {
      const created = await createNotification(app, accessToken, {
        title: 'Mark read test',
      });
      expect(created.isRead).toBe(false);

      const res = await request(app.getHttpServer())
        .patch(`${NOTIFICATIONS_PATH}/${created.id}/read`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const data = expectData(res.body as NotificationDetail);
      expect(data.id).toBe(created.id);
      expect(data.isRead).toBe(true);
      expect(data.readAt).toBeTruthy();
    });

    it('should be idempotent when marking an already-read notification', async () => {
      const created = await createNotification(app, accessToken, {
        title: 'Already read',
      });

      // First mark as read
      await request(app.getHttpServer())
        .patch(`${NOTIFICATIONS_PATH}/${created.id}/read`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      // Second time should still return 200 with isRead: true
      const res = await request(app.getHttpServer())
        .patch(`${NOTIFICATIONS_PATH}/${created.id}/read`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const data = expectData(res.body as NotificationDetail);
      expect(data.isRead).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════
  // PATCH /notifications/:id/unread — mark as unread
  // ════════════════════════════════════════════════════════════

  describe('PATCH /notifications/:id/unread', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .patch(`${NOTIFICATIONS_PATH}/fake-id/unread`)
        .expect(401);
    });

    it('should mark a read notification as unread', async () => {
      const created = await createNotification(app, accessToken, {
        title: 'Mark unread test',
      });

      // Mark as read first
      await request(app.getHttpServer())
        .patch(`${NOTIFICATIONS_PATH}/${created.id}/read`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      // Now mark as unread
      const res = await request(app.getHttpServer())
        .patch(`${NOTIFICATIONS_PATH}/${created.id}/unread`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const data = expectData(res.body as NotificationDetail);
      expect(data.id).toBe(created.id);
      expect(data.isRead).toBe(false);
      expect(data.readAt).toBeNull();
    });

    it('should increment unread count when marking as unread', async () => {
      const created = await createNotification(app, accessToken, {
        title: 'Unread count test',
      });

      // Mark as read first
      await request(app.getHttpServer())
        .patch(`${NOTIFICATIONS_PATH}/${created.id}/read`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      // Get unread count before
      const beforeRes = await request(app.getHttpServer())
        .get(`${NOTIFICATIONS_PATH}/unread-count`)
        .set('Authorization', bearer(accessToken))
        .expect(200);
      const beforeCount = expectData(beforeRes.body as { count: number }).count;

      // Mark as unread
      await request(app.getHttpServer())
        .patch(`${NOTIFICATIONS_PATH}/${created.id}/unread`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      // Get unread count after
      const afterRes = await request(app.getHttpServer())
        .get(`${NOTIFICATIONS_PATH}/unread-count`)
        .set('Authorization', bearer(accessToken))
        .expect(200);
      const afterCount = expectData(afterRes.body as { count: number }).count;

      expect(afterCount).toBe(beforeCount + 1);
    });
  });

  // ════════════════════════════════════════════════════════════
  // DELETE /notifications/:id — delete a notification
  // ════════════════════════════════════════════════════════════

  describe('DELETE /notifications/:id', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .delete(`${NOTIFICATIONS_PATH}/fake-id`)
        .expect(401);
    });

    it('should delete a notification and return 204', async () => {
      const created = await createNotification(app, accessToken, {
        title: 'Delete me',
      });

      await request(app.getHttpServer())
        .delete(`${NOTIFICATIONS_PATH}/${created.id}`)
        .set('Authorization', bearer(accessToken))
        .expect(204);

      // Verify it no longer appears in list
      const listRes = await request(app.getHttpServer())
        .get(NOTIFICATIONS_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const listData = expectData(
        listRes.body as {
          items: Array<{ id: string }>;
          total: number;
        },
      );
      expect(listData.items.find((n) => n.id === created.id)).toBeUndefined();
    });

    it('should return 404 for a non-existent id', async () => {
      await request(app.getHttpServer())
        .delete(`${NOTIFICATIONS_PATH}/nonexistent-id`)
        .set('Authorization', bearer(accessToken))
        .expect(404);
    });

    it('should not delete a notification belonging to another user', async () => {
      const created = await createNotification(app, accessToken, {
        title: 'Protected notification',
      });

      // Create a second user + token
      const otherEmail = uniqueEmail('notif-del');
      const otherUser = await ctx.prisma.user.create({
        data: {
          email: otherEmail,
          status: UserStatus.active,
        },
      });
      const otherToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        otherUser.id,
        otherUser.email!,
      );

      // Other user tries to delete — should return 404
      await request(app.getHttpServer())
        .delete(`${NOTIFICATIONS_PATH}/${created.id}`)
        .set('Authorization', bearer(otherToken))
        .expect(404);

      // Original owner can still see it
      const detailRes = await request(app.getHttpServer())
        .get(`${NOTIFICATIONS_PATH}/${created.id}`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const body = detailRes.body as NotificationDetail | null;
      expect(body).not.toBeNull();
      expect(body?.id).toBe(created.id);
    });
  });
});
