import type { DeepMocked } from '../../../../common/types/deep-mocked.js';
import type { PrismaService } from '../../../../prisma/index.js';
import { PrismaSuggestionQueries } from './suggestion-queries.js';
import { ACTIVE_LIFECYCLE_STATE } from '../../application/ports/suggestion-queries.js';

/**
 * Persistence-contract tests for the suggestion query port.
 *
 * These assert the **`where` clauses**, which is what the read models no longer
 * see: the filters must still be built here (Today = active only; history =
 * date range + locale + optional state/type), and the Today filter must come
 * from `ACTIVE_LIFECYCLE_STATE` rather than a hardcoded string.
 */
describe('PrismaSuggestionQueries', () => {
  let queries: PrismaSuggestionQueries;
  let findMany: vi.Mock;
  let count: vi.Mock;

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([]);
    count = vi.fn().mockResolvedValue(0);
    const prisma = {
      userSuggestion: { findMany, count },
    } as unknown as DeepMocked<PrismaService>;
    queries = new PrismaSuggestionQueries(prisma);
  });

  describe('findActive', () => {
    it('filters to the active lifecycle state, date and user', async () => {
      await queries.findActive('user-1', '2026-07-09');

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            date: '2026-07-09',
            lifecycleState: ACTIVE_LIFECYCLE_STATE,
          },
          orderBy: { priorityScore: 'desc' },
        }),
      );
    });

    it('narrows by sourceVersion when one is supplied', async () => {
      await queries.findActive('user-1', '2026-07-09', 7);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sourceVersion: 7 }),
        }),
      );
    });

    it('omits sourceVersion when it is not supplied', async () => {
      await queries.findActive('user-1', '2026-07-09');

      const where = findMany.mock.calls[0]![0].where as Record<string, unknown>;
      expect(where).not.toHaveProperty('sourceVersion');
    });
  });

  describe('findHistory', () => {
    const baseQuery = {
      userId: 'user-1',
      startDate: '2026-06-09',
      endDate: '2026-07-09',
      locale: 'zh-CN',
      limit: 100,
    } as const;

    it('builds the date range and locale filter', async () => {
      await queries.findHistory({ ...baseQuery });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            date: { gte: '2026-06-09', lte: '2026-07-09' },
            locale: 'zh-CN',
          },
          orderBy: { generatedAt: 'desc' },
          take: 100,
        }),
      );
      expect(count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1' }),
        }),
      );
    });

    it('passes lifecycleState and type filters through when present', async () => {
      await queries.findHistory({
        ...baseQuery,
        lifecycleState: 'dismissed',
        type: 'trend',
      });

      const where = findMany.mock.calls[0]![0].where as Record<string, unknown>;
      expect(where['lifecycleState']).toBe('dismissed');
      expect(where['type']).toBe('trend');
    });

    it('omits the optional filters when absent', async () => {
      await queries.findHistory({ ...baseQuery });

      const where = findMany.mock.calls[0]![0].where as Record<string, unknown>;
      expect(where).not.toHaveProperty('lifecycleState');
      expect(where).not.toHaveProperty('type');
    });

    it('returns the total alongside the rows', async () => {
      count.mockResolvedValue(42);
      const result = await queries.findHistory({ ...baseQuery });

      expect(result.total).toBe(42);
      expect(result.rows).toEqual([]);
    });
  });
});
