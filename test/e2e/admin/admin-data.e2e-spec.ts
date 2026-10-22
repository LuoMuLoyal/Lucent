import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AdminRole } from '#generated/prisma/client.js';
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

const DAY_MS = 24 * 60 * 60 * 1000;
const DATA_PATH = '/api/v1/admin/data';

describe('Admin data API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  let superAdmin: TestUser;
  let superToken: string;
  let opsAdmin: TestUser;
  let opsToken: string;
  let viewer: TestUser;
  let viewerToken: string;
  let editor: TestUser;
  let editorToken: string;
  let outsider: TestUser;
  let outsiderToken: string;

  let settingsUser: TestUser;

  async function adminTokenFor(user: TestUser): Promise<string> {
    return createAccessToken(
      ctx.jwtService,
      ctx.configService,
      user.id,
      user.email,
    );
  }

  async function grant(user: TestUser, role: AdminRole): Promise<string> {
    await ctx.prisma.adminUser.create({ data: { userId: user.id, role } });
    return adminTokenFor(user);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    superAdmin = await createTestUser(ctx.prisma, uniqueEmail('super'), 'Super');
    superToken = await grant(superAdmin, AdminRole.SUPER_ADMIN);

    opsAdmin = await createTestUser(ctx.prisma, uniqueEmail('ops'), 'Ops');
    opsToken = await grant(opsAdmin, AdminRole.ADMIN);

    viewer = await createTestUser(ctx.prisma, uniqueEmail('viewer'), 'Viewer');
    viewerToken = await grant(viewer, AdminRole.VIEWER);

    editor = await createTestUser(ctx.prisma, uniqueEmail('editor'), 'Editor');
    editorToken = await grant(editor, AdminRole.EDITOR);

    outsider = await createTestUser(ctx.prisma, uniqueEmail('outsider'), 'Outsider');
    outsiderToken = await adminTokenFor(outsider);

    settingsUser = await createTestUser(ctx.prisma, undefined, 'SettingsOwner');
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  describe('auth and permission gates', () => {
    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer())
        .get(`${DATA_PATH}/users`)
        .expect(401);
    });

    it('returns 403 for a non-admin account', async () => {
      await request(app.getHttpServer())
        .get(`${DATA_PATH}/users`)
        .set('Authorization', bearer(outsiderToken))
        .expect(403);
    });

    it('returns 403 for an editor without data:read', async () => {
      await request(app.getHttpServer())
        .get(`${DATA_PATH}/users`)
        .set('Authorization', bearer(editorToken))
        .expect(403);
    });
  });

  describe('reads', () => {
    it('lists rows for an admin with data:read', async () => {
      const response = await request(app.getHttpServer())
        .get(`${DATA_PATH}/users?limit=5`)
        .set('Authorization', bearer(opsToken))
        .expect(200);

      expect(response.body).toMatchObject({ page: 1, limit: 5 });
      expect(Array.isArray(response.body.items)).toBe(true);
      expect(typeof response.body.total).toBe('number');
    });

    it('allows a viewer to read', async () => {
      await request(app.getHttpServer())
        .get(`${DATA_PATH}/users`)
        .set('Authorization', bearer(viewerToken))
        .expect(200);
    });

    it('returns 404 for an unknown resource', async () => {
      await request(app.getHttpServer())
        .get(`${DATA_PATH}/not-a-table`)
        .set('Authorization', bearer(opsToken))
        .expect(404);
    });

    it('rejects a limit above the cap', async () => {
      await request(app.getHttpServer())
        .get(`${DATA_PATH}/users?limit=101`)
        .set('Authorization', bearer(opsToken))
        .expect(400);
    });

    it('omits sensitive columns from rows', async () => {
      await ctx.prisma.userSession.create({
        data: {
          userId: settingsUser.id,
          refreshTokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 7 * DAY_MS),
          lastUsedAt: new Date(),
        },
      });

      const response = await request(app.getHttpServer())
        .get(`${DATA_PATH}/user-sessions`)
        .set('Authorization', bearer(opsToken))
        .expect(200);

      const items = response.body.items as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item).not.toHaveProperty('refreshTokenHash');
      }
    });
  });

  describe('writes', () => {
    it('returns 403 for an admin without data:write', async () => {
      await request(app.getHttpServer())
        .post(`${DATA_PATH}/user-settings`)
        .set('Authorization', bearer(opsToken))
        .send({ userId: settingsUser.id, key: 'theme', value: 'dark' })
        .expect(403);
    });

    it('creates, reads, updates and deletes a row as a super administrator', async () => {
      const key = `pref-${randomUUID()}`;

      const created = await request(app.getHttpServer())
        .post(`${DATA_PATH}/user-settings`)
        .set('Authorization', bearer(superToken))
        .send({ userId: settingsUser.id, key, value: 'dark' })
        .expect(201);

      const id = created.body.id as string;
      expect(created.body).toMatchObject({ userId: settingsUser.id, key });

      await request(app.getHttpServer())
        .get(`${DATA_PATH}/user-settings/${id}`)
        .set('Authorization', bearer(superToken))
        .expect(200);

      const updated = await request(app.getHttpServer())
        .put(`${DATA_PATH}/user-settings/${id}`)
        .set('Authorization', bearer(superToken))
        .send({ value: 'light' })
        .expect(200);
      expect(updated.body.value).toBe('light');

      await request(app.getHttpServer())
        .delete(`${DATA_PATH}/user-settings/${id}`)
        .set('Authorization', bearer(superToken))
        .expect(204);

      await request(app.getHttpServer())
        .get(`${DATA_PATH}/user-settings/${id}`)
        .set('Authorization', bearer(superToken))
        .expect(404);
    });

    it('records an audit entry for a write', async () => {
      const key = `audit-${randomUUID()}`;

      const created = await request(app.getHttpServer())
        .post(`${DATA_PATH}/user-settings`)
        .set('Authorization', bearer(superToken))
        .send({ userId: settingsUser.id, key, value: 1 })
        .expect(201);

      // Scope the lookup to the row just created: `resourceId` is the only
      // stable handle in the audit entry (metadata carries field names, never
      // values), and an unscoped `findFirst` would match entries written by
      // earlier runs or by the sibling CRUD test.
      const audit = await ctx.prisma.auditLog.findFirst({
        where: {
          action: 'admin.data.create',
          resourceType: 'user-settings',
          resourceId: created.body.id as string,
        },
      });
      expect(audit?.userId).toBe(superAdmin.id);
    });

    it('refuses to write a read-only resource', async () => {
      await request(app.getHttpServer())
        .post(`${DATA_PATH}/audit-logs`)
        .set('Authorization', bearer(superToken))
        .send({ action: 'x' })
        .expect(403);
    });

    it('rejects a field outside the writable allowlist', async () => {
      await request(app.getHttpServer())
        .post(`${DATA_PATH}/user-settings`)
        .set('Authorization', bearer(superToken))
        .send({ userId: settingsUser.id, key: 'x', secret: 'y' })
        .expect(400);
    });

    it('returns 409 on a duplicate unique key', async () => {
      const key = `dup-${randomUUID()}`;
      const payload = { userId: settingsUser.id, key, value: 'a' };

      await request(app.getHttpServer())
        .post(`${DATA_PATH}/user-settings`)
        .set('Authorization', bearer(superToken))
        .send(payload)
        .expect(201);

      await request(app.getHttpServer())
        .post(`${DATA_PATH}/user-settings`)
        .set('Authorization', bearer(superToken))
        .send(payload)
        .expect(409);
    });

    it('returns 404 when updating a missing row', async () => {
      await request(app.getHttpServer())
        .put(`${DATA_PATH}/user-settings/${randomUUID()}`)
        .set('Authorization', bearer(superToken))
        .send({ value: 'z' })
        .expect(404);
    });
  });

  describe('user related aggregate', () => {
    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/users/${settingsUser.id}/related`)
        .expect(401);
    });

    it('returns 404 for an unknown user', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/users/${randomUUID()}/related`)
        .set('Authorization', bearer(opsToken))
        .expect(404);
    });

    it('groups related rows by domain and omits sensitive columns', async () => {
      await ctx.prisma.userSetting.create({
        data: { userId: settingsUser.id, key: `related-${randomUUID()}`, value: 1 },
      });
      await ctx.prisma.userSession.create({
        data: {
          userId: settingsUser.id,
          refreshTokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 7 * DAY_MS),
          lastUsedAt: new Date(),
        },
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/admin/users/${settingsUser.id}/related?limit=5`)
        .set('Authorization', bearer(opsToken))
        .expect(200);

      const body = response.body as {
        userId: string;
        groups: Array<{
          key: string;
          sections: Array<{
            resource: string;
            items: Array<Record<string, unknown>>;
            total: number;
          }>;
        }>;
      };
      expect(body.userId).toBe(settingsUser.id);
      expect(body.groups.map((g) => g.key)).toEqual(
        expect.arrayContaining(['account', 'health', 'records', 'telemetry']),
      );

      const account = body.groups.find((g) => g.key === 'account');
      const sessions = account?.sections.find(
        (s) => s.resource === 'user-sessions',
      );
      expect(sessions?.total).toBeGreaterThan(0);
      for (const item of sessions?.items ?? []) {
        expect(item).not.toHaveProperty('refreshTokenHash');
      }
    });
  });
});
