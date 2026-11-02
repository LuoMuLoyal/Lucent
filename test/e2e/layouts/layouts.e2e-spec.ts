import request from 'supertest';

import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
} from '../../helpers/e2e-helpers.js';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers.js';

const LAYOUTS_PATH = '/api/v1/layouts';

/**
 * The layout payload is opaque to the server, so these tests never assert on
 * its shape — only that it round-trips byte-for-byte. Anything more would make
 * the tests a second definition of a format the client owns.
 */
const SAMPLE_PAYLOAD = {
  placements: [
    { id: 'summary.metrics', size: 'wide', config: { kind: 'compact' } },
    { id: 'water.trend', size: 'compact' },
  ],
};

describe('Layouts API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let userId: string;
  let userEmail: string;
  let otherUserId: string;
  let otherUserEmail: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    const user = await createTestUser(ctx.prisma, undefined, 'LayoutUser');
    userId = user.id;
    userEmail = user.email;

    const other = await createTestUser(
      ctx.prisma,
      undefined,
      'OtherLayoutUser',
    );
    otherUserId = other.id;
    otherUserEmail = other.email;
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  async function makeToken(): Promise<string> {
    return createAccessToken(
      ctx.jwtService,
      ctx.configService,
      userId,
      userEmail,
    );
  }

  async function makeOtherToken(): Promise<string> {
    return createAccessToken(
      ctx.jwtService,
      ctx.configService,
      otherUserId,
      otherUserEmail,
    );
  }

  // ════════════════════════════════════════════════════════════
  // GET /layouts
  // ════════════════════════════════════════════════════════════

  describe('GET /api/v1/layouts', () => {
    it('returns an empty map for a user who never customised anything', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .get(LAYOUTS_PATH)
        .set('Authorization', bearer(token))
        .expect(200);

      expect(response.body.surfaces).toEqual({});
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get(LAYOUTS_PATH).expect(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // PUT /layouts/:surface
  // ════════════════════════════════════════════════════════════

  describe('PUT /api/v1/layouts/:surface', () => {
    it('creates a layout on first write with version 1', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .put(`${LAYOUTS_PATH}/today`)
        .set('Authorization', bearer(token))
        .send({ schemaVersion: 1, payload: SAMPLE_PAYLOAD })
        .expect(200);

      expect(response.body.surface).toBe('today');
      expect(response.body.version).toBe(1);
      expect(response.body.schemaVersion).toBe(1);
      // Opaque payload round-trips verbatim.
      expect(response.body.payload).toEqual(SAMPLE_PAYLOAD);
    });

    it('increments the version on a matching conditional write', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .put(`${LAYOUTS_PATH}/today`)
        .set('Authorization', bearer(token))
        .send({ ifVersion: 1, schemaVersion: 1, payload: { placements: [] } })
        .expect(200);

      expect(response.body.version).toBe(2);
      expect(response.body.payload).toEqual({ placements: [] });
    });

    it('rejects a stale ifVersion with 409 and the current document', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .put(`${LAYOUTS_PATH}/today`)
        .set('Authorization', bearer(token))
        .send({ ifVersion: 1, schemaVersion: 1, payload: { placements: [] } })
        .expect(409);

      expect(response.body.code).toBe('LAYOUT_VERSION_CONFLICT');
      // The winning document rides in `errors.current` so the client can adopt
      // it without a second round trip.
      expect(response.body.errors?.current?.version).toBe(2);
      expect(response.body.errors?.current?.surface).toBe('today');
    });

    it('rejects a conditional write against a surface that has no layout', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .put(`${LAYOUTS_PATH}/record`)
        .set('Authorization', bearer(token))
        .send({ ifVersion: 1, schemaVersion: 1, payload: {} })
        .expect(409);

      expect(response.body.code).toBe('LAYOUT_VERSION_CONFLICT');
      expect(response.body.errors?.current).toBeNull();
    });

    it('accepts a null ifVersion as an unconditional write', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .put(`${LAYOUTS_PATH}/medicine`)
        .set('Authorization', bearer(token))
        .send({ ifVersion: null, schemaVersion: 1, payload: { a: 1 } })
        .expect(200);

      expect(response.body.version).toBe(1);
    });

    it('rejects an unknown surface with 400', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .put(`${LAYOUTS_PATH}/settings`)
        .set('Authorization', bearer(token))
        .send({ schemaVersion: 1, payload: {} })
        .expect(400);

      expect(response.body.code).toBe('LAYOUT_SURFACE_UNKNOWN');
    });

    it('rejects an unsupported schemaVersion with 422', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .put(`${LAYOUTS_PATH}/review`)
        .set('Authorization', bearer(token))
        .send({ schemaVersion: 99, payload: {} })
        .expect(422);

      expect(response.body.code).toBe('LAYOUT_SCHEMA_VERSION_UNSUPPORTED');
    });

    it('accepts an array payload (tab_chrome-style document)', async () => {
      // The server does not know which surface carries which shape, so an array
      // is a legitimate payload: `tab_chrome` stores `[{tabId, ...}]`. Only a
      // *missing* payload is rejected.
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .put(`${LAYOUTS_PATH}/mine`)
        .set('Authorization', bearer(token))
        .send({ schemaVersion: 1, payload: [1, 2, 3] })
        .expect(200);

      expect(response.body.payload).toEqual([1, 2, 3]);
    });

    it('rejects a missing payload with 400', async () => {
      const token = await makeToken();
      await request(app.getHttpServer())
        .put(`${LAYOUTS_PATH}/review`)
        .set('Authorization', bearer(token))
        .send({ schemaVersion: 1 })
        .expect(400);
    });

    it('accepts the tab_chrome surface (tab preferences share this resource)', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .put(`${LAYOUTS_PATH}/tab_chrome`)
        .set('Authorization', bearer(token))
        .send({
          schemaVersion: 1,
          payload: [{ tabId: 'today', customLabel: 'Daily', orderIndex: 0 }],
        })
        .expect(200);

      expect(response.body.surface).toBe('tab_chrome');
    });
  });

  // ════════════════════════════════════════════════════════════
  // GET /layouts/:surface
  // ════════════════════════════════════════════════════════════

  describe('GET /api/v1/layouts/:surface', () => {
    it('returns the stored layout', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .get(`${LAYOUTS_PATH}/today`)
        .set('Authorization', bearer(token))
        .expect(200);

      expect(response.body.surface).toBe('today');
      expect(response.body.version).toBe(2);
    });

    it('returns 404 for a surface with no stored layout', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .get(`${LAYOUTS_PATH}/record`)
        .set('Authorization', bearer(token))
        .expect(404);

      expect(response.body.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('returns 400 for an unknown surface', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .get(`${LAYOUTS_PATH}/nope`)
        .set('Authorization', bearer(token))
        .expect(400);

      expect(response.body.code).toBe('LAYOUT_SURFACE_UNKNOWN');
    });
  });

  // ════════════════════════════════════════════════════════════
  // Cross-user isolation
  // ════════════════════════════════════════════════════════════

  describe('cross-user access', () => {
    it('does not leak another user’s layouts in the list', async () => {
      const otherToken = await makeOtherToken();
      const response = await request(app.getHttpServer())
        .get(LAYOUTS_PATH)
        .set('Authorization', bearer(otherToken))
        .expect(200);

      expect(response.body.surfaces).toEqual({});
    });

    it('returns 404 when another user reads a surface this user set', async () => {
      const otherToken = await makeOtherToken();
      await request(app.getHttpServer())
        .get(`${LAYOUTS_PATH}/today`)
        .set('Authorization', bearer(otherToken))
        .expect(404);
    });

    it('does not overwrite another user’s layout on write', async () => {
      const otherToken = await makeOtherToken();
      // Unconditional write: creates the *caller's* row, never touches the
      // first user's.
      await request(app.getHttpServer())
        .put(`${LAYOUTS_PATH}/today`)
        .set('Authorization', bearer(otherToken))
        .send({ schemaVersion: 1, payload: { owner: 'other' } })
        .expect(200);

      const token = await makeToken();
      const mine = await request(app.getHttpServer())
        .get(`${LAYOUTS_PATH}/today`)
        .set('Authorization', bearer(token))
        .expect(200);

      expect(mine.body.version).toBe(2);
      expect(mine.body.payload).toEqual({ placements: [] });
    });
  });
});
