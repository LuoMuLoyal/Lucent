import type { E2eApp, E2eTestContext } from '../../helpers/e2e-helpers.js';
import { createTestApp } from '../../helpers/e2e-helpers.js';

/**
 * OnSIDES adverse-reaction endpoints e2e tests.
 *
 * ## What these cover, and what they do not
 *
 * They cover the contract: routes are mounted, an unknown key is 404 (never a 200
 * with an empty list — "this ingredient has no rows" and "this ingredient does not
 * exist" are different answers and the client renders them differently), `limit`
 * bounds are enforced rather than silently clamped, and the request validates.
 *
 * They do NOT assert particular reactions. The test database has no `onsides_*`
 * rows: that is imported knowledge, not fixture data, and asserting "ibuprofen
 * should return 809 reactions" would pin the test to one import batch. Row-level
 * behaviour is covered by the adapter spec (`persistence/onsides.spec.ts`) with
 * stubbed Prisma responses.
 */

const BASE = '/api/v1/medicines';

describe('OnSIDES reactions API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  async function get(path: string): Promise<{ status: number; body: unknown }> {
    const response = await app.inject({ method: 'GET', url: path });
    return { status: response.statusCode, body: response.json() };
  }

  it('unknown ingredient CUI → 404', async () => {
    const { status } = await get(`${BASE}/ingredients/999999999/reactions`);
    expect(status).toBe(404);
  });

  it('drug without an RxCUI bridge → 404, not an empty list', async () => {
    // 91.8% of DrugBank rows have no RxCUI cross-reference, so this is the common
    // path, not an edge case. A 200 with [] would tell the client "bridged, no
    // reactions found", which is a different and wrong statement.
    const { status } = await get(`${BASE}/drugs/DB99999/reactions`);
    expect(status).toBe(404);
  });

  it('unknown MedDRA term → 404', async () => {
    const { status } = await get(`${BASE}/reactions/99999999/drugs`);
    expect(status).toBe(404);
  });

  it('limit above the cap → 400, never silently clamped', async () => {
    const { status } = await get(`${BASE}/reactions/10037844/drugs?limit=201`);
    expect(status).toBe(400);
  });

  it('limit below the floor → 400', async () => {
    const { status } = await get(`${BASE}/reactions/10037844/drugs?limit=0`);
    expect(status).toBe(400);
  });

  it('non-numeric limit → 400', async () => {
    const { status } = await get(`${BASE}/reactions/10037844/drugs?limit=many`);
    expect(status).toBe(400);
  });
});
