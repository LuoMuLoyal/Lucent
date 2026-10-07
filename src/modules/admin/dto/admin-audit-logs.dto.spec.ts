import { adminAuditLogListQuerySchema } from './admin-audit-logs.dto.js';

describe('adminAuditLogListQuerySchema', () => {
  it('provides bounded paging defaults', () => {
    expect(adminAuditLogListQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 25,
    });
  });

  it('rejects a limit above 100', () => {
    expect(
      adminAuditLogListQuerySchema.safeParse({ limit: '101' }).success,
    ).toBe(false);
  });
});
