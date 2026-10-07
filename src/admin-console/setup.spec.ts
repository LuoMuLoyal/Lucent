import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvKey } from '../config/env/env-keys.enum.js';
import { registerAdminConsole } from './setup.js';

describe('registerAdminConsole', () => {
  let consoleDir: string;
  let routes: string[];

  beforeEach(async () => {
    consoleDir = await mkdtemp(join(tmpdir(), 'lucent-console-setup-'));
    routes = [];
  });

  afterEach(async () => {
    await rm(consoleDir, { recursive: true, force: true });
  });

  function buildApp(): NestFastifyApplication {
    const fastify = {
      get: (path: string) => {
        routes.push(path);
      },
    };
    return {
      getHttpAdapter: () => ({ getInstance: () => fastify }),
    } as unknown as NestFastifyApplication;
  }

  function buildConfig(
    values: Record<string, string | undefined>,
  ): ConfigService {
    return {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
  }

  it('registers the console routes when the SPA build is present', async () => {
    await writeFile(join(consoleDir, 'index.html'), '<html>shell</html>');

    await registerAdminConsole(
      buildApp(),
      buildConfig({ [EnvKey.ADMIN_CONSOLE_DIR]: consoleDir }),
    );

    expect(routes).toEqual(['/admin', '/admin/*']);
  });

  it('skips registration when the console is disabled', async () => {
    await writeFile(join(consoleDir, 'index.html'), '<html>shell</html>');

    await registerAdminConsole(
      buildApp(),
      buildConfig({
        [EnvKey.ADMIN_CONSOLE_DIR]: consoleDir,
        [EnvKey.ADMIN_CONSOLE_ENABLED]: 'false',
      }),
    );

    expect(routes).toEqual([]);
  });

  it('warns and registers nothing when the SPA was never built', async () => {
    const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await registerAdminConsole(
      buildApp(),
      buildConfig({ [EnvKey.ADMIN_CONSOLE_DIR]: join(consoleDir, 'absent') }),
    );

    expect(routes).toEqual([]);
    warn.mockRestore();
  });
});
