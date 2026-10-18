import { AdminRole } from '#generated/prisma/client.js';
import {
  QUEUE_NAME_LIST,
  queueReadPermission,
  queueWritePermission,
} from '../../../common/queue/queue-names.js';
import { ADMIN_PERMISSIONS, hasAdminPermission } from './permissions.js';

describe('admin role permissions', () => {
  it('grants the complete permission set to SUPER_ADMIN', () => {
    expect(hasAdminPermission(AdminRole.SUPER_ADMIN, 'admin:manage')).toBe(true);
    expect(hasAdminPermission(AdminRole.SUPER_ADMIN, 'content:write')).toBe(true);
  });

  it('keeps ADMIN operations broad without granting admin management', () => {
    expect(hasAdminPermission(AdminRole.ADMIN, 'content:write')).toBe(true);
    expect(hasAdminPermission(AdminRole.ADMIN, 'users:write')).toBe(true);
    expect(hasAdminPermission(AdminRole.ADMIN, 'admin:manage')).toBe(false);
  });

  it('limits EDITOR to content permissions', () => {
    expect(hasAdminPermission(AdminRole.EDITOR, 'content:read')).toBe(true);
    expect(hasAdminPermission(AdminRole.EDITOR, 'content:write')).toBe(true);
    expect(hasAdminPermission(AdminRole.EDITOR, 'metrics:read')).toBe(false);
    expect(hasAdminPermission(AdminRole.EDITOR, 'users:write')).toBe(false);
  });

  it('keeps VIEWER read-only', () => {
    expect(hasAdminPermission(AdminRole.VIEWER, 'content:read')).toBe(true);
    expect(hasAdminPermission(AdminRole.VIEWER, 'users:read')).toBe(true);
    expect(hasAdminPermission(AdminRole.VIEWER, 'content:write')).toBe(false);
    expect(hasAdminPermission(AdminRole.VIEWER, 'users:write')).toBe(false);
  });
});

describe('queue panel permissions', () => {
  it('registers read + write points for every queue', () => {
    for (const name of QUEUE_NAME_LIST) {
      expect(ADMIN_PERMISSIONS).toContain(queueReadPermission(name));
      expect(ADMIN_PERMISSIONS).toContain(queueWritePermission(name));
    }
  });

  it('gives VIEWER read-only queue access', () => {
    const read = queueReadPermission('lucent-mail');
    const write = queueWritePermission('lucent-mail');
    expect(hasAdminPermission(AdminRole.VIEWER, read)).toBe(true);
    expect(hasAdminPermission(AdminRole.VIEWER, write)).toBe(false);
  });

  it('gives ADMIN queue write access', () => {
    expect(
      hasAdminPermission(AdminRole.ADMIN, queueWritePermission('lucent-cron')),
    ).toBe(true);
  });

  it('keeps EDITOR out of the queue panel', () => {
    expect(
      hasAdminPermission(AdminRole.EDITOR, queueReadPermission('lucent-cron')),
    ).toBe(false);
  });
});
