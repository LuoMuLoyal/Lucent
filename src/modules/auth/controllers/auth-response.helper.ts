import {
  calculateExpiresIn,
  formatDateTime,
  toEmailVerified,
} from '../../../common/helpers';
import { successEnvelope } from '../../../common/api';
import type { User } from '#generated/prisma/client';
import type { TokenPair } from '../services/token.service';

/**
 * Shared auth-response shape returned by register, login, and OAuth callback
 * endpoints. Serializes a user + token pair into the global envelope.
 */
export interface AuthResponseData {
  user: {
    id: string;
    email: string;
    nickname: string | null;
    avatar: string | null;
    emailVerified: boolean;
    emailVerifiedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

/**
 * Builds the standard auth-response envelope from a user entity and token pair.
 * Used by local (register/login), OAuth callback, and refresh endpoints.
 */
export function buildAuthResponse(
  user: Pick<
    User,
    | 'id'
    | 'email'
    | 'nickname'
    | 'avatar'
    | 'emailVerifiedAt'
    | 'createdAt'
    | 'updatedAt'
  >,
  tokens: TokenPair,
) {
  return successEnvelope({
    user: {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      emailVerified: toEmailVerified(user.emailVerifiedAt),
      emailVerifiedAt: formatDateTime(user.emailVerifiedAt),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    },
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: calculateExpiresIn(tokens.accessTokenExpiresAt),
    },
  });
}
