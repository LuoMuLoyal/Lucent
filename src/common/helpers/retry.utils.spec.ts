import { withRetry, fetchWithRetry } from './retry.utils';

describe('retry.utils', () => {
  describe('withRetry', () => {
    it('returns result on first success', async () => {
      const operation = jest.fn().mockResolvedValue('ok');
      const result = await withRetry(operation);
      expect(result).toBe('ok');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and succeeds', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('ok');

      const result = await withRetry(operation, { delayMs: 0 });
      expect(result).toBe('ok');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('throws last error after all attempts exhausted', async () => {
      const error = new Error('persistent failure');
      const operation = jest.fn().mockRejectedValue(error);

      await expect(
        withRetry(operation, { attempts: 3, delayMs: 0 }),
      ).rejects.toThrow('persistent failure');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('calls onRetry callback between attempts', async () => {
      const onRetry = jest.fn();
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('ok');

      await withRetry(operation, { delayMs: 0, onRetry });
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
    });

    it('respects attempts option', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('fail'));

      await expect(
        withRetry(operation, { attempts: 2, delayMs: 0 }),
      ).rejects.toThrow('fail');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('uses exponential backoff', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValueOnce('ok');

      const result = await withRetry(operation, {
        attempts: 3,
        delayMs: 1,
        backoff: 'exponential',
      });
      expect(result).toBe('ok');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('defaults to 1 attempt when attempts is 0', async () => {
      const operation = jest.fn().mockResolvedValue('ok');
      const result = await withRetry(operation, { attempts: 0 });
      expect(result).toBe('ok');
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchWithRetry', () => {
    it('returns successful response', async () => {
      const mockResponse = { ok: true, status: 200 } as Response;
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(mockResponse);

      const result = await fetchWithRetry('https://example.com');
      expect(result).toBe(mockResponse);
      expect(fetchSpy).toHaveBeenCalledWith('https://example.com', {});
      fetchSpy.mockRestore();
    });

    it('retries on non-ok response', async () => {
      const failResponse = { ok: false, status: 500 } as Response;
      const okResponse = { ok: true, status: 200 } as Response;
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(okResponse);

      const result = await fetchWithRetry('https://example.com', {
        attempts: 2,
        delayMs: 0,
      });
      expect(result).toBe(okResponse);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      fetchSpy.mockRestore();
    });

    it('retries on network failure (fetch throws)', async () => {
      const okResponse = { ok: true, status: 200 } as Response;
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(okResponse);

      const result = await fetchWithRetry('https://example.com', {
        attempts: 2,
        delayMs: 0,
      });
      expect(result).toBe(okResponse);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      fetchSpy.mockRestore();
    });

    it('passes fetch init options to fetch', async () => {
      const mockResponse = { ok: true, status: 200 } as Response;
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(mockResponse);

      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'value' }),
      };

      await fetchWithRetry('https://example.com', init);
      expect(fetchSpy).toHaveBeenCalledWith('https://example.com', init);
      fetchSpy.mockRestore();
    });

    it('throws after all attempts on persistent non-ok', async () => {
      const failResponse = { ok: false, status: 503 } as Response;
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(failResponse);

      await expect(
        fetchWithRetry('https://example.com', {
          attempts: 2,
          delayMs: 0,
        }),
      ).rejects.toThrow('HTTP 503');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      fetchSpy.mockRestore();
    });
  });
});
