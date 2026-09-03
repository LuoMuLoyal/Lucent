import { SuggestionCacheService } from './suggestion-cache.service.js';
import { BaselineDimension } from '../../types/baseline.types.js';

describe('SuggestionCacheService', () => {
  let service: SuggestionCacheService;
  let cacheGetMock: vi.Mock;
  let cacheSetMock: vi.Mock;
  let cacheDelMock: vi.Mock;

  beforeEach(() => {
    cacheGetMock = vi.fn();
    cacheSetMock = vi.fn();
    cacheDelMock = vi.fn();

    const cacheMock = {
      get: cacheGetMock,
      set: cacheSetMock,
      del: cacheDelMock,
    };

    service = new SuggestionCacheService(cacheMock as never);
  });

  describe('Signals cache', () => {
    it('should get cached signals', async () => {
      const mockSignals = [{ signalId: 'sig-1' }];
      cacheGetMock.mockResolvedValue(mockSignals);

      const result = await service.getSignals('user-1', '2026-07-09');
      expect(result).toEqual(mockSignals);
      expect(cacheGetMock).toHaveBeenCalledWith(
        'today-suggestion:signals:user-1:2026-07-09',
      );
    });

    it('should return undefined when signals not cached', async () => {
      cacheGetMock.mockResolvedValue(undefined);

      const result = await service.getSignals('user-1', '2026-07-09');
      expect(result).toBeUndefined();
    });

    it('should set signals with TTL', async () => {
      const signals = [{ signalId: 'sig-1' }];
      await service.setSignals('user-1', '2026-07-09', signals as never);

      expect(cacheSetMock).toHaveBeenCalledWith(
        'today-suggestion:signals:user-1:2026-07-09',
        signals,
        expect.any(Number),
      );
    });
  });

  describe('Suggestions cache', () => {
    it('should get cached suggestions', async () => {
      const mockResult = { generatedAt: '2026-07-09T00:00:00.000Z' };
      cacheGetMock.mockResolvedValue(mockResult);

      const result = await service.getSuggestions(
        'user-1',
        '2026-07-09',
        'none',
      );
      expect(result).toEqual(mockResult);
    });

    it('should set suggestions with TTL', async () => {
      const result = { generatedAt: '2026-07-09T00:00:00.000Z' } as never;
      await service.setSuggestions('user-1', '2026-07-09', 'none', result);

      // Should set the suggestion cache entry
      expect(cacheSetMock).toHaveBeenCalledWith(
        'today-suggestion:suggestions:user-1:2026-07-09:none',
        result,
        expect.any(Number),
      );
      // Should also track the excludeKey in the registry
      expect(cacheSetMock).toHaveBeenCalledWith(
        'today-suggestion:exclude_keys:user-1:2026-07-09',
        ['none'],
        expect.any(Number),
      );
    });
  });

  describe('Baseline cache', () => {
    it('should get cached baseline status as Map', async () => {
      cacheGetMock.mockResolvedValue({
        water_intake: true,
        sleep_duration: false,
      });

      const result = await service.getBaselineStatus('user-1');
      expect(result).toBeInstanceOf(Map);
      expect(result!.get(BaselineDimension.WATER_INTAKE)).toBe(true);
      expect(result!.get(BaselineDimension.SLEEP_DURATION)).toBe(false);
    });

    it('should return undefined when baseline not cached', async () => {
      cacheGetMock.mockResolvedValue(undefined);

      const result = await service.getBaselineStatus('user-1');
      expect(result).toBeUndefined();
    });

    it('should set baseline status from Map', async () => {
      const status = new Map([
        [BaselineDimension.WATER_INTAKE, true],
        [BaselineDimension.SLEEP_DURATION, false],
      ]);

      await service.setBaselineStatus('user-1', status);

      expect(cacheSetMock).toHaveBeenCalledWith(
        'today-suggestion:baseline:user-1',
        { water_intake: true, sleep_duration: false },
        expect.any(Number),
      );
    });
  });

  describe('Invalidation', () => {
    it('should invalidate signals and suggestions on invalidateSignals', async () => {
      // Simulate a registry with multiple excludeKeys. The invalidation
      // reads the registry twice (two passes) to catch concurrent writes.
      cacheGetMock
        .mockResolvedValueOnce(['none', 'id1,id2'])
        .mockResolvedValueOnce([]);

      await service.invalidateSignals('user-1', '2026-07-09');

      // Should delete signal cache
      expect(cacheDelMock).toHaveBeenCalledWith(
        'today-suggestion:signals:user-1:2026-07-09',
      );
      // First pass: delete all registered suggestion cache variants
      expect(cacheDelMock).toHaveBeenCalledWith(
        'today-suggestion:suggestions:user-1:2026-07-09:none',
      );
      expect(cacheDelMock).toHaveBeenCalledWith(
        'today-suggestion:suggestions:user-1:2026-07-09:id1,id2',
      );
      // Should delete the registry itself (both passes)
      expect(cacheDelMock).toHaveBeenCalledWith(
        'today-suggestion:exclude_keys:user-1:2026-07-09',
      );
      // Second pass: delete the fallback 'none' variant and re-delete the
      // registry, catching variants registered during the first pass.
      expect(cacheDelMock).toHaveBeenCalledTimes(6);
    });

    it('should fallback to deleting none when registry is empty', async () => {
      cacheGetMock
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await service.invalidateSuggestions('user-1', '2026-07-09');

      expect(cacheDelMock).toHaveBeenCalledWith(
        'today-suggestion:suggestions:user-1:2026-07-09:none',
      );
      expect(cacheDelMock).toHaveBeenCalledWith(
        'today-suggestion:exclude_keys:user-1:2026-07-09',
      );
    });

    it('should invalidate baseline on invalidateBaseline', async () => {
      await service.invalidateBaseline('user-1');

      expect(cacheDelMock).toHaveBeenCalledTimes(1);
      expect(cacheDelMock).toHaveBeenCalledWith(
        'today-suggestion:baseline:user-1',
      );
    });
  });

  describe('buildExcludeKey', () => {
    it('should return none for empty or undefined', () => {
      expect(SuggestionCacheService.buildExcludeKey()).toBe('none');
      expect(SuggestionCacheService.buildExcludeKey([])).toBe('none');
    });

    it('should return sorted comma-joined string', () => {
      expect(SuggestionCacheService.buildExcludeKey(['b', 'a', 'c'])).toBe(
        'a,b,c',
      );
    });

    it('should return the single element for single-item array', () => {
      expect(SuggestionCacheService.buildExcludeKey(['only'])).toBe('only');
    });

    it('should sort unsorted single element', () => {
      expect(SuggestionCacheService.buildExcludeKey(['z'])).toBe('z');
    });

    it('should handle duplicate IDs by including them all', () => {
      const result = SuggestionCacheService.buildExcludeKey(['a', 'a', 'b']);
      // Duplicates are not removed, just sorted and joined
      expect(result).toBe('a,a,b');
    });

    it('should not mutate the input array', () => {
      const input = ['c', 'a', 'b'];
      SuggestionCacheService.buildExcludeKey(input);
      // Original array should not be sorted in-place
      expect(input).toEqual(['c', 'a', 'b']);
    });

    it('should handle IDs with special characters', () => {
      expect(SuggestionCacheService.buildExcludeKey(['id:1', 'id:2'])).toBe(
        'id:1,id:2',
      );
    });
  });
});
