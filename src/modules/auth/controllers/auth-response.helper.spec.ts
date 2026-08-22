import { buildAuthResponse } from './auth-response.helper';
import { calculateExpiresIn } from '../../../common';
import type { User } from '#generated/prisma/client';
import type { TokenPair } from '../types/auth-request';

describe('auth-response.helper', () => {
  const mockUser: Pick<
    User,
    | 'id'
    | 'email'
    | 'nickname'
    | 'avatar'
    | 'emailVerifiedAt'
    | 'createdAt'
    | 'updatedAt'
  > = {
    id: 'user-1',
    email: 'test@example.com',
    nickname: 'TestUser',
    avatar: 'https://example.com/avatar.png',
    emailVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-11T00:00:00.000Z'),
  };

  const mockTokens: TokenPair = {
    accessToken: 'access-token-123',
    refreshToken: 'refresh-token-456',
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };

  it('builds a direct auth resource with user and tokens', () => {
    const result = buildAuthResponse(mockUser, mockTokens);

    expect(result).toHaveProperty('user');
    expect(result).toHaveProperty('tokens');
  });

  it('serializes user fields correctly', () => {
    const result = buildAuthResponse(mockUser, mockTokens);
    const data = result as any;

    expect(data.user.id).toBe('user-1');
    expect(data.user.email).toBe('test@example.com');
    expect(data.user.nickname).toBe('TestUser');
    expect(data.user.avatar).toBe('https://example.com/avatar.png');
    expect(data.user.emailVerified).toBe(true);
    expect(data.user.emailVerifiedAt).toBe(
      mockUser.emailVerifiedAt!.toISOString(),
    );
    expect(data.user.createdAt).toBe(mockUser.createdAt.toISOString());
    expect(data.user.updatedAt).toBe(mockUser.updatedAt.toISOString());
  });

  it('serializes token fields correctly', () => {
    const result = buildAuthResponse(mockUser, mockTokens);
    const data = result as any;

    expect(data.tokens.accessToken).toBe('access-token-123');
    expect(data.tokens.refreshToken).toBe('refresh-token-456');
    expect(data.tokens.expiresIn).toBe(
      calculateExpiresIn(mockTokens.accessTokenExpiresAt),
    );
  });

  it('sets emailVerified to false when emailVerifiedAt is null', () => {
    const unverifiedUser = { ...mockUser, emailVerifiedAt: null };
    const result = buildAuthResponse(unverifiedUser, mockTokens);
    const data = result as any;

    expect(data.user.emailVerified).toBe(false);
    expect(data.user.emailVerifiedAt).toBeNull();
  });

  it('handles null nickname and avatar', () => {
    const minimalUser = {
      ...mockUser,
      nickname: null,
      avatar: null,
    };
    const result = buildAuthResponse(minimalUser, mockTokens);
    const data = result as any;

    expect(data.user.nickname).toBeNull();
    expect(data.user.avatar).toBeNull();
  });

  it('does not add a generic response envelope', () => {
    const result = buildAuthResponse(mockUser, mockTokens);
    expect(result).not.toHaveProperty('code');
    expect(result).not.toHaveProperty('message');
    expect(result).not.toHaveProperty('data');
  });
});
