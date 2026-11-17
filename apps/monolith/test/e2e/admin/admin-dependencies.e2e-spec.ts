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

const DEPENDENCIES_PATH = '/api/v1/admin/dependencies';

describe('Admin dependencies API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  let opsAdmin: TestUser;
  let opsToken: string;
  let editor: TestUser;
  let editorToken: string;
  let outsider: TestUser;
  let outsiderToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    opsAdmin = await createTestUser(ctx.prisma, uniqueEmail('deps'), 'DepsOps');
    await ctx.prisma.adminUser.create({
      data: { userId: opsAdmin.id, role: AdminRole.ADMIN },
    });
    opsToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      opsAdmin.id,
      opsAdmin.email,
    );

    editor = await createTestUser(ctx.prisma, uniqueEmail('deps-ed'), 'DepsEd');
    await ctx.prisma.adminUser.create({
      data: { userId: editor.id, role: AdminRole.EDITOR },
    });
    editorToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      editor.id,
      editor.email,
    );

    outsider = await createTestUser(
      ctx.prisma,
      uniqueEmail('deps-out'),
      'DepsOut',
    );
    outsiderToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      outsider.id,
      outsider.email,
    );
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  it('returns 401 for an unauthenticated request', async () => {
    await request(app.getHttpServer()).get(DEPENDENCIES_PATH).expect(401);
  });

  it('returns 403 for a non-admin account', async () => {
    await request(app.getHttpServer())
      .get(DEPENDENCIES_PATH)
      .set('Authorization', bearer(outsiderToken))
      .expect(403);
  });

  it('returns 403 for an editor without ops:read', async () => {
    await request(app.getHttpServer())
      .get(DEPENDENCIES_PATH)
      .set('Authorization', bearer(editorToken))
      .expect(403);
  });

  it('reports sidecar enablement flags only', async () => {
    const response = await request(app.getHttpServer())
      .get(DEPENDENCIES_PATH)
      .set('Authorization', bearer(opsToken))
      .expect(200);

    expect(response.body).toEqual({
      lightrag: { enabled: expect.any(Boolean) },
      semantica: { enabled: expect.any(Boolean) },
      generatedAt: expect.any(String),
    });
    // Flags only — never the base URLs, keys or any other topology detail.
    const json = JSON.stringify(response.body);
    expect(json).not.toContain('baseUrl');
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('http');
  });
});
