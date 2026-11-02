import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  ADMIN_CONSOLE_ROOT_PATH,
  CONSOLE_NOT_FOUND_STATUS,
} from '../constants/console.constants.js';
import type { ConsoleAssetsService } from './console-assets.service.js';

const ASSET_NOT_FOUND_BODY = 'Admin console asset not found';

/**
 * Registers the `/admin` routes that serve the built SPA.
 *
 * Routes are registered directly on Fastify (not through a Nest controller) so
 * the console stays outside the `/api` global prefix and `/api/v1` versioning,
 * and so the SPA fallback can return `index.html` for arbitrary client-side
 * paths that no Nest route declares.
 */
export function registerAdminConsoleRoutes(
  fastify: FastifyInstance,
  assets: ConsoleAssetsService,
): void {
  fastify.get(ADMIN_CONSOLE_ROOT_PATH, (_request, reply) => {
    reply.redirect(`${ADMIN_CONSOLE_ROOT_PATH}/`);
  });

  fastify.get(
    `${ADMIN_CONSOLE_ROOT_PATH}/*`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const asset = await assets.read(readRequestPath(request.url));
      if (asset === null) {
        return reply
          .code(CONSOLE_NOT_FOUND_STATUS)
          .type('text/plain; charset=utf-8')
          .send(ASSET_NOT_FOUND_BODY);
      }
      // The reply must be returned, not merely sent: Fastify resolves an async
      // handler to `undefined` and then sends an empty body, unless the reply
      // was already flushed. `@fastify/compress` only flushes synchronously for
      // payloads under its 4 KiB sync threshold; larger ones (the SPA shell,
      // every bundle) go through a stream, so the resolved `undefined` would win
      // and every asset above that size arrived empty — a blank `/admin`.
      return reply
        .type(asset.contentType)
        .header('Cache-Control', asset.cacheControl)
        .send(asset.body);
    },
  );
}

/**
 * Extracts the root-relative path from a raw request URL. `request.url` carries
 * the query string, and `new URL` also rejects inputs that are not absolute.
 */
function readRequestPath(rawUrl: string): string {
  const pathname = new URL(rawUrl, 'http://localhost').pathname;
  return pathname.slice(ADMIN_CONSOLE_ROOT_PATH.length + 1);
}
