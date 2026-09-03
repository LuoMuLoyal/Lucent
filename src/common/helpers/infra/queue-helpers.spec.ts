import { enqueueOrFallback } from './queue-helpers.js';

describe('enqueueOrFallback', () => {
  it('returns { jobId } when queue is configured and enqueue succeeds', async () => {
    const result = await enqueueOrFallback(
      true,
      'test-queue',
      () => Promise.resolve('job-123'),
      () => Promise.resolve('fallback-result'),
      'result',
    );

    expect(result).toEqual({ jobId: 'job-123' });
  });

  it('falls back to sync when queue is not configured', async () => {
    const fallback = vi.fn().mockResolvedValue('sync-result');

    const result = await enqueueOrFallback(
      false,
      'test-queue',
      () => Promise.resolve('job-1'),
      fallback,
      'result',
    );

    expect(result).toEqual({ result: 'sync-result' });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('falls back to sync when enqueue returns null despite being configured', async () => {
    const fallback = vi.fn().mockResolvedValue('sync-result');

    const result = await enqueueOrFallback(
      true,
      'test-queue',
      () => Promise.resolve(null),
      fallback,
      'result',
    );

    expect(result).toEqual({ result: 'sync-result' });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('falls back to sync when enqueue throws (Redis configured but down)', async () => {
    const enqueue = vi
      .fn()
      .mockRejectedValue(new Error('Redis connection lost'));
    const fallback = vi.fn().mockResolvedValue('sync-result');

    const result = await enqueueOrFallback(
      true,
      'test-queue',
      enqueue,
      fallback,
      'result',
    );

    expect(result).toEqual({ result: 'sync-result' });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('falls back to sync when enqueue throws an errno-coded error', async () => {
    const enqueue = vi.fn().mockImplementation(() => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:6379') as Error & {
        code: string;
      };
      err.code = 'ECONNREFUSED';
      return Promise.reject(err);
    });
    const fallback = vi.fn().mockResolvedValue('sync-result');

    const result = await enqueueOrFallback(
      true,
      'test-queue',
      enqueue,
      fallback,
      'result',
    );

    expect(result).toEqual({ result: 'sync-result' });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('rethrows programming errors instead of falling back', async () => {
    const enqueue = vi
      .fn()
      .mockRejectedValue(new TypeError('Cannot read property of undefined'));
    const fallback = vi.fn().mockResolvedValue('sync-result');

    await expect(
      enqueueOrFallback(true, 'test-queue', enqueue, fallback, 'result'),
    ).rejects.toThrow(TypeError);

    expect(fallback).not.toHaveBeenCalled();
  });

  it('rethrows business errors that mention Redis but are not connection errors', async () => {
    const enqueue = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'Redis transaction failed: invalid data format in user profile',
        ),
      );
    const fallback = vi.fn().mockResolvedValue('sync-result');

    await expect(
      enqueueOrFallback(true, 'test-queue', enqueue, fallback, 'result'),
    ).rejects.toThrow('Redis transaction failed');

    expect(fallback).not.toHaveBeenCalled();
  });

  it('rethrows generic errors that mention timeout but are not connection errors', async () => {
    const enqueue = vi
      .fn()
      .mockRejectedValue(new Error('Operation timeout in business logic'));
    const fallback = vi.fn().mockResolvedValue('sync-result');

    await expect(
      enqueueOrFallback(true, 'test-queue', enqueue, fallback, 'result'),
    ).rejects.toThrow('Operation timeout');

    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses custom fallbackKey in the returned object', async () => {
    const result = await enqueueOrFallback(
      false,
      'test-queue',
      () => Promise.resolve('job-1'),
      () => Promise.resolve('base64-data'),
      'pdfBase64',
    );

    expect(result).toEqual({ pdfBase64: 'base64-data' });
  });

  it('does not call enqueue when queue is not configured', async () => {
    const enqueue = vi.fn().mockResolvedValue('job-1');

    await enqueueOrFallback(
      false,
      'test-queue',
      enqueue,
      () => Promise.resolve('fallback'),
      'result',
    );

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not call fallback when enqueue succeeds', async () => {
    const fallback = vi.fn().mockResolvedValue('fallback');

    await enqueueOrFallback(
      true,
      'test-queue',
      () => Promise.resolve('job-1'),
      fallback,
      'result',
    );

    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses the provided logger instance on connection-error fallback', async () => {
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
      log: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
      fatal: vi.fn(),
    };
    const enqueue = vi.fn().mockRejectedValue(new Error('Connection refused'));
    const fallback = vi.fn().mockResolvedValue('sync-result');

    await enqueueOrFallback(
      true,
      'test-queue',
      enqueue,
      fallback,
      'result',
      logger as never,
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Enqueue failed for queue "test-queue"'),
      expect.any(String),
    );
  });
});
