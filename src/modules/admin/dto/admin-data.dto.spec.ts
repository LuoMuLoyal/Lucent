import {
  adminResourceListQuerySchema,
  adminResourceListResponseSchema,
  adminResourceWriteSchema,
} from './admin-data.dto.js';

describe('admin data DTOs', () => {
  describe('adminResourceListQuerySchema', () => {
    it('applies pagination defaults', () => {
      expect(adminResourceListQuerySchema.parse({})).toEqual({
        page: 1,
        limit: 25,
        order: 'desc',
      });
    });

    it('coerces page and limit from query strings', () => {
      const parsed = adminResourceListQuerySchema.parse({
        page: '3',
        limit: '50',
        sort: 'createdAt',
        order: 'asc',
      });
      expect(parsed).toEqual({
        page: 3,
        limit: 50,
        sort: 'createdAt',
        order: 'asc',
      });
    });

    it('rejects unknown keys', () => {
      expect(() =>
        adminResourceListQuerySchema.parse({ sneaky: '1' }),
      ).toThrow();
    });

    it('rejects a limit above the cap', () => {
      expect(() => adminResourceListQuerySchema.parse({ limit: 101 })).toThrow();
    });

    it('rejects a non-uuid userId', () => {
      expect(() =>
        adminResourceListQuerySchema.parse({ userId: 'not-a-uuid' }),
      ).toThrow();
    });
  });

  describe('adminResourceWriteSchema', () => {
    it('accepts an arbitrary object', () => {
      expect(adminResourceWriteSchema.parse({ a: 1, b: 'x' })).toEqual({
        a: 1,
        b: 'x',
      });
    });
  });

  describe('adminResourceListResponseSchema', () => {
    it('accepts a page of rows', () => {
      expect(
        adminResourceListResponseSchema.parse({
          items: [{ id: '1' }],
          total: 1,
          page: 1,
          limit: 25,
        }),
      ).toEqual({ items: [{ id: '1' }], total: 1, page: 1, limit: 25 });
    });
  });
});
