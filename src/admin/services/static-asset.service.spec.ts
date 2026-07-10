import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerAdminStaticAssets } from './static-asset.service';
import type { AdminAsset } from '../types/types';

/** Helper: wait until predicate returns true or timeout. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe('registerAdminStaticAssets', () => {
  let mockApp: { use: jest.Mock };
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    mockApp = { use: jest.fn() };
    tmpDir = join(tmpdir(), `admin-static-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    tmpFile = join(tmpDir, 'test.txt');
    writeFileSync(tmpFile, 'hello world');
  });

  afterEach(() => {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  });

  function getMiddleware(): (
    req: unknown,
    res: unknown,
    next: unknown,
  ) => void {
    return mockApp.use.mock.calls[0]?.[1] as (
      req: unknown,
      res: unknown,
      next: unknown,
    ) => void;
  }

  it('registers a middleware for each asset path', () => {
    const assets: AdminAsset[] = [{ path: '/test.txt', src: tmpFile }];
    registerAdminStaticAssets(mockApp as never, '/admin', assets);

    expect(mockApp.use).toHaveBeenCalledTimes(1);
    expect(mockApp.use).toHaveBeenCalledWith(
      '/admin/test.txt',
      expect.any(Function),
    );
  });

  it('sends 405 for non-GET/HEAD methods', async () => {
    const assets: AdminAsset[] = [{ path: '/test.txt', src: tmpFile }];
    registerAdminStaticAssets(mockApp as never, '/admin', assets);

    const middleware = getMiddleware();
    const req = { method: 'POST' };
    const res = { sendStatus: jest.fn() };

    // The middleware is fire-and-forget; 405 path is synchronous inside async fn
    middleware(req, res, jest.fn());
    await waitFor(() => res.sendStatus.mock.calls.length > 0);

    expect(res.sendStatus).toHaveBeenCalledWith(405);
  });

  it('sends file content for GET requests', async () => {
    const assets: AdminAsset[] = [{ path: '/test.txt', src: tmpFile }];
    registerAdminStaticAssets(mockApp as never, '/admin', assets);

    const middleware = getMiddleware();
    const req = { method: 'GET' };
    const res = {
      type: jest.fn(),
      setHeader: jest.fn(),
      end: jest.fn(),
    };

    middleware(req, res, jest.fn());
    await waitFor(() => res.setHeader.mock.calls.length > 0);

    expect(res.type).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Length',
      expect.any(String),
    );
  });

  it('ends response without body for HEAD requests', async () => {
    const assets: AdminAsset[] = [{ path: '/test.txt', src: tmpFile }];
    registerAdminStaticAssets(mockApp as never, '/admin', assets);

    const middleware = getMiddleware();
    const req = { method: 'HEAD' };
    const res = {
      type: jest.fn(),
      setHeader: jest.fn(),
      end: jest.fn(),
    };

    middleware(req, res, jest.fn());
    await waitFor(() => res.end.mock.calls.length > 0);

    expect(res.type).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Length',
      expect.any(String),
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('calls next with error when file does not exist', async () => {
    const assets: AdminAsset[] = [
      { path: '/missing.txt', src: '/nonexistent/file.txt' },
    ];
    registerAdminStaticAssets(mockApp as never, '/admin', assets);

    const middleware = getMiddleware();
    const nextFn = jest.fn();
    const req = { method: 'GET' };
    const res = { type: jest.fn(), setHeader: jest.fn() };

    middleware(req, res, nextFn);
    await waitFor(() => nextFn.mock.calls.length > 0);

    expect(nextFn).toHaveBeenCalled();
    const error = nextFn.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(Error);
  });
});
