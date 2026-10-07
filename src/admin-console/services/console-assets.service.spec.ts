import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConsoleAssetsService } from './console-assets.service.js';

describe('ConsoleAssetsService', () => {
  let rootDir: string;
  let assets: ConsoleAssetsService;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'lucent-console-'));
    await writeFile(join(rootDir, 'index.html'), '<html>shell</html>');
    await mkdir(join(rootDir, 'assets'), { recursive: true });
    await writeFile(
      join(rootDir, 'assets', 'index-abc123.js'),
      'console.log(1)',
    );
    await writeFile(
      join(rootDir, 'assets', 'index-abc123.css'),
      'a{color:red}',
    );
    assets = new ConsoleAssetsService(rootDir);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('reports the presence of the SPA entry point', async () => {
    await expect(assets.hasEntryPoint()).resolves.toBe(true);
    await expect(
      new ConsoleAssetsService(join(rootDir, 'missing')).hasEntryPoint(),
    ).resolves.toBe(false);
  });

  it('serves index.html for the console root without caching it', async () => {
    const asset = await assets.read('');

    expect(asset?.body.toString()).toBe('<html>shell</html>');
    expect(asset?.contentType).toBe('text/html; charset=utf-8');
    expect(asset?.cacheControl).toBe('no-cache');
  });

  it('serves hashed assets with an immutable cache and the right content type', async () => {
    const script = await assets.read('assets/index-abc123.js');
    const stylesheet = await assets.read('assets/index-abc123.css');

    expect(script?.contentType).toBe('text/javascript; charset=utf-8');
    expect(script?.cacheControl).toBe('public, max-age=31536000, immutable');
    expect(stylesheet?.contentType).toBe('text/css; charset=utf-8');
  });

  it('falls back to the SPA shell for extension-less client routes', async () => {
    const asset = await assets.read('content/safety-tips');

    expect(asset?.body.toString()).toBe('<html>shell</html>');
    expect(asset?.cacheControl).toBe('no-cache');
  });

  it('returns null for a missing file that has an extension', async () => {
    await expect(assets.read('assets/missing-xyz.js')).resolves.toBeNull();
    await expect(assets.read('favicon.ico')).resolves.toBeNull();
  });

  it.each([
    '../secrets.env',
    'assets/../../secrets.env',
    '%2e%2e%2fsecrets.env',
    '..\\secrets.env',
    'assets/%00index-abc123.js',
    '%zz',
  ])('rejects the unsafe request path %s', async (requestPath) => {
    await expect(assets.read(requestPath)).resolves.toBeNull();
  });

  it('collapses duplicate and dot segments instead of resolving them', async () => {
    const asset = await assets.read('./assets//index-abc123.js');

    expect(asset?.contentType).toBe('text/javascript; charset=utf-8');
  });

  it('never serves a directory, falling back to the SPA shell instead', async () => {
    const asset = await assets.read('assets');

    expect(asset?.body.toString()).toBe('<html>shell</html>');
    expect(asset?.contentType).toBe('text/html; charset=utf-8');
  });
});
