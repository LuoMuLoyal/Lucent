import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AdminRole, UserStatus } from '#generated/prisma/client.js';
import {
  bearer,
  cleanupDatabase,
  createAccessToken,
  createTestApp,
  createTestUser,
  uniqueEmail,
} from '../../helpers/e2e-helpers.js';
import type {
  E2eApp,
  E2eTestContext,
  TestUser,
} from '../../helpers/e2e-helpers.js';

const ADMIN_USERS_PATH = '/api/v1/admin/users';
const ADMIN_ADMINS_PATH = '/api/v1/admin/admins';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Admin management API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  let opsAdmin: TestUser;
  let opsToken: string;
  let superAdmin: TestUser;
  let superToken: string;
  let editor: TestUser;
  let editorToken: string;
  let outsider: TestUser;
  let outsiderToken: string;

  let targetUser: TestUser;
  let deletableUser: TestUser;
  let sessionUser: TestUser;
  let shareUser: TestUser;
  let rbacUser: TestUser;

  async function seedSession(userId: string): Promise<string> {
    const session = await ctx.prisma.userSession.create({
      data: {
        familyId: randomUUID(),
        userId,
        refreshTokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 7 * DAY_MS),
        lastUsedAt: new Date(),
      },
    });
    return session.id;
  }

  async function seedShare(userId: string): Promise<string> {
    const share = await ctx.prisma.userClinicSummaryShare.create({
      data: {
        userId,
        tokenHash: randomUUID(),
        selectedFields: ['event_overview'],
        expiresAt: new Date(Date.now() + 7 * DAY_MS),
      },
    });
    return share.id;
  }

  async function adminTokenFor(user: TestUser): Promise<string> {
    return createAccessToken(
      ctx.jwtService,
      ctx.configService,
      user.id,
      user.email,
    );
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    opsAdmin = await createTestUser(ctx.prisma, uniqueEmail('ops'), 'OpsAdmin');
    await ctx.prisma.adminUser.create({
      data: { userId: opsAdmin.id, role: AdminRole.ADMIN },
    });
    opsToken = await adminTokenFor(opsAdmin);

    superAdmin = await createTestUser(
      ctx.prisma,
      uniqueEmail('super'),
      'SuperAdmin',
    );
    await ctx.prisma.adminUser.create({
      data: { userId: superAdmin.id, role: AdminRole.SUPER_ADMIN },
    });
    superToken = await adminTokenFor(superAdmin);

    editor = await createTestUser(ctx.prisma, uniqueEmail('editor'), 'Editor');
    await ctx.prisma.adminUser.create({
      data: { userId: editor.id, role: AdminRole.EDITOR },
    });
    editorToken = await adminTokenFor(editor);

    outsider = await createTestUser(
      ctx.prisma,
      uniqueEmail('outsider'),
      'Outsider',
    );
    outsiderToken = await adminTokenFor(outsider);

    targetUser = await createTestUser(ctx.prisma, undefined, 'Target');
    deletableUser = await createTestUser(ctx.prisma, undefined, 'Deletable');
    sessionUser = await createTestUser(ctx.prisma, undefined, 'SessionOwner');
    shareUser = await createTestUser(ctx.prisma, undefined, 'ShareOwner');
    rbacUser = await createTestUser(ctx.prisma, undefined, 'RbacUser');
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  describe('auth and permission gates', () => {
    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer())
        .patch(`${ADMIN_USERS_PATH}/${targetUser.id}/status`)
        .send({ status: UserStatus.suspended })
        .expect(401);
    });

    it('returns 403 for a non-admin account', async () => {
      await request(app.getHttpServer())
        .patch(`${ADMIN_USERS_PATH}/${targetUser.id}/status`)
        .set('Authorization', bearer(outsiderToken))
        .send({ status: UserStatus.suspended })
        .expect(403);
    });

    it('returns 403 for an editor without users:write', async () => {
      await request(app.getHttpServer())
        .patch(`${ADMIN_USERS_PATH}/${targetUser.id}/status`)
        .set('Authorization', bearer(editorToken))
        .send({ status: UserStatus.suspended })
        .expect(403);
    });
  });

  describe('user lifecycle writes', () => {
    it("refuses to change the caller's own status", async () => {
      await request(app.getHttpServer())
        .patch(`${ADMIN_USERS_PATH}/${opsAdmin.id}/status`)
        .set('Authorization', bearer(opsToken))
        .send({ status: UserStatus.suspended })
        .expect(403);
    });

    it('refuses to act on a super administrator', async () => {
      await request(app.getHttpServer())
        .patch(`${ADMIN_USERS_PATH}/${superAdmin.id}/status`)
        .set('Authorization', bearer(opsToken))
        .send({ status: UserStatus.suspended })
        .expect(403);
    });

    it('suspends a user, revokes their sessions, and records the audit trail', async () => {
      const sessionId = await seedSession(targetUser.id);

      const response = await request(app.getHttpServer())
        .patch(`${ADMIN_USERS_PATH}/${targetUser.id}/status`)
        .set('Authorization', bearer(opsToken))
        .send({ status: UserStatus.suspended })
        .expect(200);

      expect(response.body).toMatchObject({
        id: targetUser.id,
        status: UserStatus.suspended,
      });

      const row = await ctx.prisma.user.findUnique({
        where: { id: targetUser.id },
        select: { status: true },
      });
      expect(row?.status).toBe(UserStatus.suspended);

      const session = await ctx.prisma.userSession.findUnique({
        where: { id: sessionId },
      });
      expect(session).toBeNull();

      const statusAudit = await ctx.prisma.auditLog.findFirst({
        where: {
          action: 'admin.users.status.update',
          resourceId: targetUser.id,
        },
      });
      expect(statusAudit).not.toBeNull();
      expect(statusAudit?.userId).toBe(opsAdmin.id);
    });

    it('reactivates a suspended user without revoking sessions', async () => {
      const response = await request(app.getHttpServer())
        .patch(`${ADMIN_USERS_PATH}/${targetUser.id}/status`)
        .set('Authorization', bearer(opsToken))
        .send({ status: UserStatus.active })
        .expect(200);

      expect(response.body).toMatchObject({
        id: targetUser.id,
        status: UserStatus.active,
      });
    });

    it('returns 404 when the target user does not exist', async () => {
      await request(app.getHttpServer())
        .patch(`${ADMIN_USERS_PATH}/${randomUUID()}/status`)
        .set('Authorization', bearer(opsToken))
        .send({ status: UserStatus.suspended })
        .expect(404);
    });

    it('soft-deletes a user and hides them from the admin listing', async () => {
      await request(app.getHttpServer())
        .delete(`${ADMIN_USERS_PATH}/${deletableUser.id}`)
        .set('Authorization', bearer(opsToken))
        .expect(204);

      const row = await ctx.prisma.user.findUnique({
        where: { id: deletableUser.id },
        select: { status: true, deletedAt: true },
      });
      expect(row?.status).toBe(UserStatus.deleted);
      expect(row?.deletedAt).not.toBeNull();

      await request(app.getHttpServer())
        .get(`${ADMIN_USERS_PATH}/${deletableUser.id}`)
        .set('Authorization', bearer(opsToken))
        .expect(404);
    });
  });

  describe('session revocation', () => {
    it('returns 404 for a session owned by another user', async () => {
      const sessionId = await seedSession(sessionUser.id);

      await request(app.getHttpServer())
        .delete(
          `${ADMIN_USERS_PATH}/${outsider.id}/sessions/${sessionId}`,
        )
        .set('Authorization', bearer(opsToken))
        .expect(404);
    });

    it('revokes the session and hides it from the active list', async () => {
      const sessionId = await seedSession(sessionUser.id);

      await request(app.getHttpServer())
        .delete(`${ADMIN_USERS_PATH}/${sessionUser.id}/sessions/${sessionId}`)
        .set('Authorization', bearer(opsToken))
        .expect(204);

      const session = await ctx.prisma.userSession.findUnique({
        where: { id: sessionId },
        select: { revokedAt: true },
      });
      expect(session?.revokedAt).not.toBeNull();
    });
  });

  describe('clinic-summary share revocation', () => {
    it('returns 404 for a share owned by another user', async () => {
      const shareId = await seedShare(shareUser.id);

      await request(app.getHttpServer())
        .delete(`${ADMIN_USERS_PATH}/${outsider.id}/shares/${shareId}`)
        .set('Authorization', bearer(opsToken))
        .expect(404);
    });

    it('revokes the share and is idempotent', async () => {
      const shareId = await seedShare(shareUser.id);

      await request(app.getHttpServer())
        .delete(`${ADMIN_USERS_PATH}/${shareUser.id}/shares/${shareId}`)
        .set('Authorization', bearer(opsToken))
        .expect(204);

      const share = await ctx.prisma.userClinicSummaryShare.findUnique({
        where: { id: shareId },
        select: { revokedAt: true },
      });
      expect(share?.revokedAt).not.toBeNull();

      await request(app.getHttpServer())
        .delete(`${ADMIN_USERS_PATH}/${shareUser.id}/shares/${shareId}`)
        .set('Authorization', bearer(opsToken))
        .expect(204);
    });
  });

  describe('administrator role management', () => {
    it('returns 403 for an admin without admin:manage', async () => {
      await request(app.getHttpServer())
        .get(ADMIN_ADMINS_PATH)
        .set('Authorization', bearer(opsToken))
        .expect(403);
    });

    it('lists administrator grants for a super administrator', async () => {
      const response = await request(app.getHttpServer())
        .get(ADMIN_ADMINS_PATH)
        .set('Authorization', bearer(superToken))
        .expect(200);

      const body = response.body as {
        items: Array<{ userId: string; role: AdminRole }>;
        total: number;
      };
      expect(body.items.map((item) => item.userId)).toEqual(
        expect.arrayContaining([superAdmin.id, opsAdmin.id]),
      );
    });

    it('grants a role and records the audit entry', async () => {
      const response = await request(app.getHttpServer())
        .put(`${ADMIN_ADMINS_PATH}/${rbacUser.id}`)
        .set('Authorization', bearer(superToken))
        .send({ role: AdminRole.ADMIN })
        .expect(200);

      expect(response.body).toMatchObject({
        userId: rbacUser.id,
        role: AdminRole.ADMIN,
      });

      const audit = await ctx.prisma.auditLog.findFirst({
        where: { action: 'admin.admins.role.set', resourceId: rbacUser.id },
      });
      expect(audit?.userId).toBe(superAdmin.id);
    });

    it('revokes a role grant', async () => {
      await request(app.getHttpServer())
        .delete(`${ADMIN_ADMINS_PATH}/${rbacUser.id}`)
        .set('Authorization', bearer(superToken))
        .expect(204);

      const grant = await ctx.prisma.adminUser.findUnique({
        where: { userId: rbacUser.id },
      });
      expect(grant).toBeNull();
    });

    it('refuses to change the caller\'s own role', async () => {
      await request(app.getHttpServer())
        .put(`${ADMIN_ADMINS_PATH}/${superAdmin.id}`)
        .set('Authorization', bearer(superToken))
        .send({ role: AdminRole.ADMIN })
        .expect(403);
    });

    it('refuses to remove the caller\'s own grant', async () => {
      await request(app.getHttpServer())
        .delete(`${ADMIN_ADMINS_PATH}/${superAdmin.id}`)
        .set('Authorization', bearer(superToken))
        .expect(403);
    });
  });
});
