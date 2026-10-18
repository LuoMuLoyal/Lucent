import {
  ADMIN_RESOURCES,
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
