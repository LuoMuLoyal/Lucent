import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { HttpAdapterHost } from '@nestjs/core';
import { AdminRole } from '#generated/prisma/client.js';
import type { Mock } from 'vitest';
import type { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import type { AuditLogService } from '../../../audit-log/index.js';
import { QUEUE_PANEL_COOKIE_NAME } from '../../constants/queue-panel.constants.js';
import type { AdminAccessService } from '../../infrastructure/persistence/access.service.js';
import { QueuePanelAuthService } from './queue-panel-auth.service.js';
import { QueuePanelService } from './queue-panel.service.js';

const ACCESS_SECRET = 'queue-panel-test-secret-value-0123456789';
const ISSUER = 'lucent';
const AUDIENCE = 'lucent-client';
const jwt = new JwtService();

async function signAccessToken(
  sub: string,
  status = 'active',
): Promise<string> {
  return jwt.signAsync(
    { sub, email: `${sub}@example.com`, status },
    {
      secret: ACCESS_SECRET,
      algorithm: 'HS512',
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: 3600,
    },
  );
}

interface PanelHarness {
  app: FastifyInstance;
  logFireAndForget: Mock;
}

/**
 * Builds a real Fastify instance with the panel registered but zero queues, so
 * every assertion below exercises routing + auth + audit without needing Redis.
 * Per-queue behaviour is covered by the auth-service and e2e specs.
 */
async function createPanel(
  roles: Record<string, AdminRole>,
): Promise<PanelHarness> {
  const app = Fastify({ logger: false });
  // 生产里 cookie 支持由 setup-app.ts 注册。这个夹具自建的是独立 Fastify
  // 实例，没有插件时 `request.cookies` / `reply.setCookie` 都不存在，会 500。
  await app.register(fastifyCookie);
  const logFireAndForget = vi.fn();

  const auth = new QueuePanelAuthService(
    {
      getOrThrow: () => ({
        accessSecret: ACCESS_SECRET,
        accessTtl: 3600,
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    } as unknown as ConfigService,
    {
      getRole: (userId: string) => Promise.resolve(roles[userId] ?? null),
    } as unknown as AdminAccessService,
  );

  const service = new QueuePanelService(
    {
      httpAdapter: { getInstance: () => app },
    } as unknown as HttpAdapterHost,
    { getQueues: () => [] } as unknown as BullmqQueueFactory,
    auth,
    { logFireAndForget } as unknown as AuditLogService,
  );

  await service.onApplicationBootstrap();
  await app.ready();
  return { app, logFireAndForget };
}

const ROLES: Record<string, AdminRole> = {
  'admin-1': AdminRole.ADMIN,
  'viewer-1': AdminRole.VIEWER,
  'editor-1': AdminRole.EDITOR,
};

describe('QueuePanelService', () => {
  let app: FastifyInstance;
  let logFireAndForget: Mock;

  beforeEach(async () => {
    const panel = await createPanel(ROLES);
    app = panel.app;
    logFireAndForget = panel.logFireAndForget;
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/queues/api/queues',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'AUTH_REQUIRED' });
  });

  it('rejects a valid token without queue read permission with 403', async () => {
    const token = await signAccessToken('editor-1');
    const response = await app.inject({
      method: 'GET',
      url: '/admin/queues/api/queues',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('serves the queue list to an authenticated admin', async () => {
    const token = await signAccessToken('admin-1');
    const response = await app.inject({
      method: 'GET',
      url: '/admin/queues/api/queues',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ queues: [] });
  });

  it('mints a session cookie from the query token and strips the token', async () => {
    const token = await signAccessToken('admin-1');
    const response = await app.inject({
      method: 'GET',
      url: `/admin/queues?access_token=${token}`,
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/admin/queues');
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toContain(`${QUEUE_PANEL_COOKIE_NAME}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/admin/queues');

    const followed = await app.inject({
      method: 'GET',
      url: '/admin/queues/api/queues',
      headers: { cookie: cookie.split(';')[0] ?? '' },
    });
    expect(followed.statusCode).toBe(200);
  });

  it('requires auth on the entry route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/queues',
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('denies and audits a global mutation for a read-only admin', async () => {
    const token = await signAccessToken('viewer-1');
    const response = await app.inject({
      method: 'PUT',
      url: '/admin/queues/api/queues/pause',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    expect(logFireAndForget).toHaveBeenCalledTimes(1);
    expect(logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'viewer-1',
        action: 'admin.queue.pauseAll',
        resourceType: 'queue',
      }),
    );
  });

  it('denies a queue-scoped mutation without the queue write point', async () => {
    const token = await signAccessToken('viewer-1');
    const response = await app.inject({
      method: 'PUT',
      url: '/admin/queues/api/queues/lucent-cron/pause',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    expect(logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.queue.pause',
        resourceId: 'lucent-cron',
      }),
    );
  });

  it('allows and audits a global mutation for a write-capable admin', async () => {
    const token = await signAccessToken('admin-1');
    const response = await app.inject({
      method: 'PUT',
      url: '/admin/queues/api/queues/pause',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'admin.queue.pauseAll',
        resourceType: 'queue',
      }),
    );
  });

  it('does not audit reads', async () => {
    const token = await signAccessToken('admin-1');
    await app.inject({
      method: 'GET',
      url: '/admin/queues/api/queues',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(logFireAndForget).not.toHaveBeenCalled();
  });
});
