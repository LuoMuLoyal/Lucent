import {
  ADMIN_RESOURCES,
  ADMIN_USER_RELATED_GROUPS,
  adminResourceSortFields,
  getAdminResource,
} from './resource-registry.js';

describe('admin resource registry', () => {
  it('registers every Prisma table exactly once', () => {
    expect(ADMIN_RESOURCES).toHaveLength(51);
    expect(new Set(ADMIN_RESOURCES.map((r) => r.key)).size).toBe(51);
    expect(new Set(ADMIN_RESOURCES.map((r) => r.model)).size).toBe(51);
  });

  it('keeps sensitive columns out of the writable allowlist', () => {
    for (const resource of ADMIN_RESOURCES) {
      const writable = new Set(resource.writableFields);
      for (const field of resource.omitFields) {
        expect(writable.has(field)).toBe(false);
      }
    }
  });

  it('gives every writable resource a non-empty allowlist and readOnly none', () => {
    for (const resource of ADMIN_RESOURCES) {
      if (resource.readOnly) {
        expect(resource.writableFields).toHaveLength(0);
      } else {
        expect(resource.writableFields.length).toBeGreaterThan(0);
      }
    }
  });

  it('marks credential and token columns as omitted', () => {
    const accounts = getAdminResource('accounts');
    expect(accounts?.omitFields).toEqual(
      expect.arrayContaining([
        'password',
        'accessToken',
        'refreshToken',
        'idToken',
        'rawProfile',
      ]),
    );
    expect(getAdminResource('user-sessions')?.omitFields).toContain(
      'refreshTokenHash',
    );
    expect(getAdminResource('user-clinic-summary-shares')?.omitFields).toContain(
      'tokenHash',
    );
  });

  it('marks import and log tables read-only', () => {
    for (const key of [
      'audit-logs',
      'user-product-events',
      'drug-source-imports',
      'drugbank-drugs',
      'drugbank-structures',
    ]) {
      expect(getAdminResource(key)?.readOnly).toBe(true);
    }
  });

  it('returns undefined for an unknown key', () => {
    expect(getAdminResource('not-a-table')).toBeUndefined();
  });

  describe('user-related groups', () => {
    it('resolves every group reference to a registered resource', () => {
      const keys = ADMIN_USER_RELATED_GROUPS.map((g) => g.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const group of ADMIN_USER_RELATED_GROUPS) {
        expect(group.resources.length).toBeGreaterThan(0);
      }
    });

    it('only lists resources scoped by userId', () => {
      for (const group of ADMIN_USER_RELATED_GROUPS) {
        for (const resource of group.resources) {
          const scoped =
            resource.idField === 'userId' ||
            resource.filterFields.includes('userId');
          expect(scoped).toBe(true);
        }
      }
    });

    it('groups the expected account and telemetry tables', () => {
      const all = ADMIN_USER_RELATED_GROUPS.flatMap((g) =>
        g.resources.map((r) => r.key),
      );
      expect(all).toEqual(
        expect.arrayContaining([
          'accounts',
          'user-sessions',
          'user-profiles',
          'user-allergies',
          'user-daily-records',
          'assistant-conversations',
          'user-notification-preferences',
          'user-product-events',
        ]),
      );
      expect(new Set(all).size).toBe(all.length);
    });
  });

  it('exposes createdAt, the id field and filter columns as sortable', () => {
    const resource = getAdminResource('user-sessions');
    expect(resource).toBeDefined();
    if (resource === undefined) return;
    const sortable = adminResourceSortFields(resource);
    expect(sortable).toEqual(
      expect.arrayContaining(['createdAt', 'id', 'userId']),
    );
  });
});
