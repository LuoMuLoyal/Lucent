import request from 'supertest';
import { AdminRole } from '#generated/prisma/client.js';

import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
} from '../../helpers/e2e-helpers.js';
import type {
  E2eTestContext,
  E2eApp,
  TestUser,
} from '../../helpers/e2e-helpers.js';

const PANEL_PATH = '/admin/queues';
const QUEUES_API_PATH = `${PANEL_PATH}/api/queues`;
const AUDIT_LOGS_PATH = '/api/v1/admin/audit-logs';
const AUDIT_POLL_TIMEOUT_MS = 5_000;

interface AuditLogRow {
  id: string;
  userId: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
}

describe('Admin queue panel (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let admin: TestUser;
  let adminToken: string;
  let member: TestUser;
  let memberToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    admin = await createTestUser(ctx.prisma, undefined, 'QueuePanelAdmin');
    await ctx.prisma.adminUser.create({
      data: { userId: admin.id, role: AdminRole.SUPER_ADMIN },
    });
    adminToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      admin.id,
      admin.email,
    );

    member = await createTestUser(ctx.prisma, undefined, 'QueuePanelMember');
    memberToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      member.id,
      member.email,
    );
  });

  afterAll(async () => {
    await ctx.prisma.auditLog.deleteMany({ where: { userId: admin.id } });
    await cleanupDatabase(ctx.prisma);
    await Promise.race([
      app.close(),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, 10_000);
      }),
    ]);
  }, 30_000);

  it('rejects an unauthenticated request with 401', async () => {
    await request(app.getHttpServer()).get(PANEL_PATH).expect(401);
  });

  it('rejects an authenticated non-admin with 403', async () => {
    await request(app.getHttpServer())
      .get(QUEUES_API_PATH)
      .set('Authorization', bearer(memberToken))
      .expect(403);
  });

  it('serves the panel HTML and the queue list to an admin', async () => {
    const panel = await request(app.getHttpServer())
      .get(PANEL_PATH)
      .set('Authorization', bearer(adminToken))
      .expect(200);
    expect(String(panel.headers['content-type'])).toContain('text/html');

    const list = await request(app.getHttpServer())
      .get(QUEUES_API_PATH)
      .set('Authorization', bearer(adminToken))
      .expect(200);
    expect(Array.isArray((list.body as { queues: unknown[] }).queues)).toBe(
      true,
    );
  });

  it('records a queue mutation in the audit log and exposes it via the admin API', async () => {
    const list = await request(app.getHttpServer())
      .get(QUEUES_API_PATH)
      .set('Authorization', bearer(adminToken))
      .expect(200);
    const target = (list.body as { queues: { name: string }[] }).queues[0]
      ?.name;

    // With Redis configured (CI) a named queue is paused; without it the panel
    // has no queues and the global pause route is the mutation under test.
    const mutationPath =
      target === undefined
        ? `${QUEUES_API_PATH}/pause`
        : `${QUEUES_API_PATH}/${target}/pause`;
    const expectedAction =
      target === undefined ? 'admin.queue.pauseAll' : 'admin.queue.pause';

    await request(app.getHttpServer())
      .put(mutationPath)
      .set('Authorization', bearer(adminToken))
      .expect(200);

    if (target !== undefined) {
      await request(app.getHttpServer())
        .put(`${QUEUES_API_PATH}/${target}/resume`)
        .set('Authorization', bearer(adminToken))
        .expect(200);
    }

    const entry = await waitForAuditEntry(ctx, admin.id, expectedAction, target);
    expect(entry.resourceType).toBe('queue');

    const auditList = await request(app.getHttpServer())
      .get(`${AUDIT_LOGS_PATH}?action=${encodeURIComponent(expectedAction)}`)
      .set('Authorization', bearer(adminToken))
      .expect(200);
    const items = (auditList.body as { items: AuditLogRow[] }).items;
    expect(items.some((item) => item.id === entry.id)).toBe(true);
  });
});

/**
 * Fire-and-forget audit writes land after the response, so poll until the row
 * appears instead of asserting immediately.
 */
async function waitForAuditEntry(
  ctx: E2eTestContext,
  userId: string,
  action: string,
  resourceId: string | undefined,
): Promise<AuditLogRow> {
  const deadline = Date.now() + AUDIT_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const row = await ctx.prisma.auditLog.findFirst({
      where: {
        userId,
        action,
        ...(resourceId === undefined ? {} : { resourceId }),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (row !== null) {
      return row;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Audit entry not written in time: ${action}`);
}
