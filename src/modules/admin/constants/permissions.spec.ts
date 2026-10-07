import { AdminRole } from '#generated/prisma/client.js';
import { hasAdminPermission } from './permissions.js';

describe('admin role permissions', () => {
  it('grants the complete permission set to SUPER_ADMIN', () => {
    expect(hasAdminPermission(AdminRole.SUPER_ADMIN, 'admin:manage')).toBe(true);
    expect(hasAdminPermission(AdminRole.SUPER_ADMIN, 'content:write')).toBe(true);
  });

  it('keeps ADMIN operations broad without granting admin management', () => {
    expect(hasAdminPermission(AdminRole.ADMIN, 'content:write')).toBe(true);
    expect(hasAdminPermission(AdminRole.ADMIN, 'admin:manage')).toBe(false);
  });

  it('limits EDITOR to content permissions', () => {
    expect(hasAdminPermission(AdminRole.EDITOR, 'content:read')).toBe(true);
    expect(hasAdminPermission(AdminRole.EDITOR, 'content:write')).toBe(true);
    expect(hasAdminPermission(AdminRole.EDITOR, 'metrics:read')).toBe(false);
  });

  it('keeps VIEWER read-only', () => {
    expect(hasAdminPermission(AdminRole.VIEWER, 'content:read')).toBe(true);
    expect(hasAdminPermission(AdminRole.VIEWER, 'content:write')).toBe(false);
  });
});
