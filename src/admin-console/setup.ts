import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { EnvKey } from '../config/env/env-keys.enum.js';
import { ADMIN_CONSOLE_ROOT_PATH } from './constants/console.constants.js';
import { ConsoleAssetsService } from './services/console-assets.service.js';
import { registerAdminConsoleRoutes } from './services/console-router.service.js';

// Project root in both layouts: `src/admin-console/*` in development and
// `dist/admin-console/*` after `nest build` — the compiled tree mirrors `src`.
const thisDir = dirname(fileURLToPath(import.meta.url));

/**
 * Serves the built administration SPA at `/admin` from the same origin as the
 * API, so no CORS exception or separate web server is required.
 *
 * The SPA is a static shell: it authenticates against `POST /api/v1/auth/login`
 * and reads `GET /api/v1/admin/me`, and every administration API re-checks the
 * caller's role and permission server-side.
 */
export async function registerAdminConsole(
  app: NestFastifyApplication,
  configService: ConfigService,
): Promise<void> {
  const logger = new Logger('AdminConsole');

  if (configService.get<string>(EnvKey.ADMIN_CONSOLE_ENABLED) === 'false') {
    logger.log(
      'Admin console disabled (ADMIN_CONSOLE_ENABLED=false); skipping registration.',
    );
    return;
  }

  const rootDir = resolveConsoleDir(configService);
  const assets = new ConsoleAssetsService(rootDir);

  if (!(await assets.hasEntryPoint())) {
    logger.warn(
      `Admin console build not found at ${rootDir}; /admin is not served. Build it with "pnpm install && pnpm build" inside Lucent/admin, or point ADMIN_CONSOLE_DIR at the build output.`,
    );
    return;
  }

  registerAdminConsoleRoutes(app.getHttpAdapter().getInstance(), assets);
  logger.log(
    `Admin console served from ${rootDir} at ${ADMIN_CONSOLE_ROOT_PATH}`,
  );
}

function resolveConsoleDir(configService: ConfigService): string {
  const configured = configService.get<string>(EnvKey.ADMIN_CONSOLE_DIR);
  if (configured !== undefined && configured.trim() !== '') {
    return resolve(configured.trim());
  }
  return join(thisDir, '..', '..', 'admin', 'dist');
}
