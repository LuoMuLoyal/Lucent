import { AdminRole } from '#generated/prisma/client.js';
import { adminIdentityResponseSchema } from './admin-identity.dto.js';

describe('adminIdentityResponseSchema', () => {
  it('accepts a valid administrator identity and permission list', () => {
    expect(
      adminIdentityResponseSchema.safeParse({
        id: 'user-1',
        email: 'admin@example.com',
        nickname: null,
        avatar: null,
        role: AdminRole.VIEWER,
        permissions: ['metrics:read', 'users:read'],
      }).success,
    ).toBe(true);
  });

  it('rejects permissions outside the server permission vocabulary', () => {
    expect(
      adminIdentityResponseSchema.safeParse({
        id: 'user-1',
        email: 'admin@example.com',
        nickname: null,
        avatar: null,
        role: AdminRole.VIEWER,
        permissions: ['users:delete'],
      }).success,
    ).toBe(false);
  });
});
