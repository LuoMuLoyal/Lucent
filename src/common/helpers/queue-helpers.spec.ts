import { enqueueOrFallback } from './queue-helpers';

describe('enqueueOrFallback', () => {
  it('returns { jobId } when queue is configured and enqueue succeeds', async () => {
    const result = await enqueueOrFallback(
      true,
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
      () => Promise.resolve(null),
      fallback,
      'result',
    );

    expect(result).toEqual({ result: 'sync-result' });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('uses custom fallbackKey in the returned object', async () => {
    const result = await enqueueOrFallback(
      false,
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
      () => Promise.resolve('job-1'),
      fallback,
      'result',
    );

    expect(fallback).not.toHaveBeenCalled();
  });
});
