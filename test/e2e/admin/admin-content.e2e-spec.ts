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

const QA_CHUNKS_PATH = '/api/v1/admin/content/qa-chunks';

describe('Admin content API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  let editor: TestUser;
  let editorToken: string;
  let viewer: TestUser;
  let viewerToken: string;
  let outsider: TestUser;
  let outsiderToken: string;

  let chunkId: string;

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

    editor = await createTestUser(ctx.prisma, uniqueEmail('editor'), 'Editor');
    editorToken = await grant(editor, AdminRole.EDITOR);

    viewer = await createTestUser(ctx.prisma, uniqueEmail('viewer'), 'Viewer');
    viewerToken = await grant(viewer, AdminRole.VIEWER);

    outsider = await createTestUser(
      ctx.prisma,
      uniqueEmail('outsider'),
      'Outsider',
    );
    outsiderToken = await adminTokenFor(outsider);

    const chunk = await ctx.prisma.medicalQaChunk.create({
      data: {
        qaId: `E2E-${randomUUID()}`,
        question: '高血压怎么预防？',
        answer: '低盐饮食、规律运动、控制体重，并遵医嘱用药。',
        safetyLabel: 'safe',
      },
    });
    chunkId = chunk.id;
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  describe('auth and permission gates', () => {
    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer()).get(QA_CHUNKS_PATH).expect(401);
    });

    it('returns 403 for a non-admin account', async () => {
      await request(app.getHttpServer())
        .get(QA_CHUNKS_PATH)
        .set('Authorization', bearer(outsiderToken))
        .expect(403);
    });
  });

  describe('qa corpus chunks', () => {
    it('lists the corpus for an editor with content:read', async () => {
      const response = await request(app.getHttpServer())
        .get(`${QA_CHUNKS_PATH}?limit=5`)
        .set('Authorization', bearer(editorToken))
        .expect(200);

      expect(response.body).toMatchObject({ page: 1, limit: 5 });
      expect(Array.isArray(response.body.items)).toBe(true);
      expect(typeof response.body.total).toBe('number');
    });

    it('rejects a limit above the cap', async () => {
      await request(app.getHttpServer())
        .get(`${QA_CHUNKS_PATH}?limit=101`)
        .set('Authorization', bearer(editorToken))
        .expect(400);
    });

    it('filters by safety label and free-text query', async () => {
      const response = await request(app.getHttpServer())
        .get(`${QA_CHUNKS_PATH}?safetyLabel=safe&q=高血压`)
        .set('Authorization', bearer(viewerToken))
        .expect(200);

      const body = response.body as {
        items: Array<{ id: string; safetyLabel: string }>;
      };
      expect(body.items.some((item) => item.id === chunkId)).toBe(true);
      for (const item of body.items) {
        expect(item.safetyLabel).toBe('safe');
      }
    });

    it('rejects a safety label outside the corpus domain', async () => {
      await request(app.getHttpServer())
        .get(`${QA_CHUNKS_PATH}?safetyLabel=general`)
        .set('Authorization', bearer(editorToken))
        .expect(400);

      await request(app.getHttpServer())
        .put(`${QA_CHUNKS_PATH}/${chunkId}`)
        .set('Authorization', bearer(editorToken))
        .send({ safetyLabel: 'general' })
        .expect(400);
    });

    it('lets an editor update a chunk and records the actor', async () => {
      const response = await request(app.getHttpServer())
        .put(`${QA_CHUNKS_PATH}/${chunkId}`)
        .set('Authorization', bearer(editorToken))
        .send({ safetyLabel: 'blocked' })
        .expect(200);

      expect(response.body).toMatchObject({
        id: chunkId,
        safetyLabel: 'blocked',
      });

      const audit = await ctx.prisma.auditLog.findFirst({
        where: { action: 'admin.content.qa_chunk.update', resourceId: chunkId },
      });
      expect(audit).not.toBeNull();
      expect(audit?.userId).toBe(editor.id);
    });

    it('keeps the corpus identity read-only', async () => {
      await request(app.getHttpServer())
        .put(`${QA_CHUNKS_PATH}/${chunkId}`)
        .set('Authorization', bearer(editorToken))
        .send({ qaId: 'Q-rewritten' })
        .expect(400);
    });

    it('returns 404 when updating a missing chunk', async () => {
      await request(app.getHttpServer())
        .put(`${QA_CHUNKS_PATH}/${randomUUID()}`)
        .set('Authorization', bearer(editorToken))
        .send({ question: 'changed' })
        .expect(404);
    });
  });
});
