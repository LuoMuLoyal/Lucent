import { gunzipSync } from 'node:zlib';

import compress from '@fastify/compress';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { ADMIN_CONSOLE_ROOT_PATH } from '../constants/console.constants.js';
import type {
  ConsoleAsset,
  ConsoleAssetsService,
} from './console-assets.service.js';
import { registerAdminConsoleRoutes } from './console-router.service.js';

interface RegisteredRoute {
  path: string;
  handler: (request: FastifyRequest, reply: FastifyReply) => unknown;
}

function buildFastifyStub(): {
  fastify: FastifyInstance;
  routes: RegisteredRoute[];
} {
  const routes: RegisteredRoute[] = [];
  const fastify = {
    get: (path: string, handler: RegisteredRoute['handler']) => {
      routes.push({ path, handler });
    },
  } as unknown as FastifyInstance;
  return { fastify, routes };
}

function buildReplyStub() {
  const reply = {
    code: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply & {
    code: ReturnType<typeof vi.fn>;
    type: ReturnType<typeof vi.fn>;
    header: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    redirect: ReturnType<typeof vi.fn>;
  };
}

function buildAssetsStub(asset: ConsoleAsset | null) {
  const read = vi.fn().mockResolvedValue(asset);
  return { read } as unknown as ConsoleAssetsService & {
    read: ReturnType<typeof vi.fn>;
  };
}

describe('registerAdminConsoleRoutes', () => {
  it('registers the console root and the wildcard asset route', () => {
    const { fastify, routes } = buildFastifyStub();

    registerAdminConsoleRoutes(fastify, buildAssetsStub(null));

    expect(routes.map((route) => route.path)).toEqual([
      ADMIN_CONSOLE_ROOT_PATH,
      `${ADMIN_CONSOLE_ROOT_PATH}/*`,
    ]);
  });

  it('redirects the bare console root to the trailing-slash path', () => {
    const { fastify, routes } = buildFastifyStub();
    registerAdminConsoleRoutes(fastify, buildAssetsStub(null));
    const reply = buildReplyStub();

    routes[0]?.handler({} as FastifyRequest, reply);

    expect(reply.redirect).toHaveBeenCalledWith(`${ADMIN_CONSOLE_ROOT_PATH}/`);
  });

  it('serves a resolved asset with its content type and cache header', async () => {
    const asset: ConsoleAsset = {
      body: Buffer.from('console.log(1)'),
      contentType: 'text/javascript; charset=utf-8',
      cacheControl: 'public, max-age=31536000, immutable',
    };
    const assets = buildAssetsStub(asset);
    const { fastify, routes } = buildFastifyStub();
    registerAdminConsoleRoutes(fastify, assets);
    const reply = buildReplyStub();

    await routes[1]?.handler(
      { url: '/admin/assets/index-abc123.js?v=1' } as FastifyRequest,
      reply,
    );

    expect(assets.read).toHaveBeenCalledWith('assets/index-abc123.js');
    expect(reply.type).toHaveBeenCalledWith('text/javascript; charset=utf-8');
    expect(reply.header).toHaveBeenCalledWith(
      'Cache-Control',
      'public, max-age=31536000, immutable',
    );
    expect(reply.send).toHaveBeenCalledWith(asset.body);
  });

  it('serves the index shell for a client-side route', async () => {
    const assets = buildAssetsStub({
      body: Buffer.from('<html>shell</html>'),
      contentType: 'text/html; charset=utf-8',
      cacheControl: 'no-cache',
    });
    const { fastify, routes } = buildFastifyStub();
    registerAdminConsoleRoutes(fastify, assets);
    const reply = buildReplyStub();

    await routes[1]?.handler(
      { url: '/admin/content/safety-tips' } as FastifyRequest,
      reply,
    );

    expect(assets.read).toHaveBeenCalledWith('content/safety-tips');
    expect(reply.type).toHaveBeenCalledWith('text/html; charset=utf-8');
  });

  it('serves an asset body above the compression sync threshold in full', async () => {
    // `@fastify/compress` streams any payload above its 4 KiB sync threshold.
    // An async handler that only calls `reply.send()` resolves to `undefined`,
    // and Fastify then flushes an empty body — which blanked the SPA shell and
    // every bundle. The handler must return the reply instead.
    const shell = Buffer.from(
      `<html><body>${'<script type="module" src="/admin/assets/chunk.js"></script>'.repeat(120)}</body></html>`,
    );
    const fastify = Fastify();
    await fastify.register(compress, { global: true, encodings: ['gzip'] });
    registerAdminConsoleRoutes(
      fastify,
      buildAssetsStub({
        body: shell,
        contentType: 'text/html; charset=utf-8',
        cacheControl: 'no-cache',
      }),
    );

    const response = await fastify.inject({
      method: 'GET',
      url: `${ADMIN_CONSOLE_ROOT_PATH}/`,
      headers: { 'accept-encoding': 'gzip' },
    });
    await fastify.close();

    expect(shell.byteLength).toBeGreaterThan(4096);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.rawPayload.byteLength).toBeGreaterThan(0);
    expect(gunzipSync(response.rawPayload).toString('utf-8')).toBe(
      shell.toString('utf-8'),
    );
  });

  it('answers 404 when the asset cannot be served', async () => {
    const { fastify, routes } = buildFastifyStub();
    registerAdminConsoleRoutes(fastify, buildAssetsStub(null));
    const reply = buildReplyStub();

    await routes[1]?.handler(
      { url: '/admin/assets/missing.js' } as FastifyRequest,
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith('Admin console asset not found');
  });
});
