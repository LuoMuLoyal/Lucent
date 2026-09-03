import { nonDeleted } from './prisma.utils.js';

describe('prisma.utils', () => {
  describe('nonDeleted', () => {
    it('is a constant with deletedAt: null', () => {
      expect(nonDeleted).toEqual({ deletedAt: null });
    });

    it('is readonly (frozen shape)', () => {
      expect(nonDeleted.deletedAt).toBeNull();
    });

    it('can be spread into a Prisma where clause', () => {
      const where = { ...nonDeleted, userId: 'user-1' };
      expect(where).toEqual({ deletedAt: null, userId: 'user-1' });
    });
  });
});
