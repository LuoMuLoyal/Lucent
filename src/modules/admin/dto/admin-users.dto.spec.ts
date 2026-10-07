import { adminUserListQuerySchema } from './admin-users.dto.js';

describe('adminUserListQuerySchema', () => {
  it('provides bounded paging defaults', () => {
    expect(adminUserListQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 25,
    });
  });

  it('rejects a limit above 100', () => {
    expect(adminUserListQuerySchema.safeParse({ limit: '101' }).success).toBe(
      false,
    );
  });
});
