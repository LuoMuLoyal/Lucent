import type { Prisma } from '../../generated/prisma/client';

export const OAUTH_PROVIDER_WECHAT_WEB = 'wechat_web';

export interface OAuthAuthorizeResult {
  authorizeUrl: string;
  state: string;
  expiresIn: number;
}

export interface OAuthProfile {
  provider: typeof OAUTH_PROVIDER_WECHAT_WEB;
  providerUserId: string;
  unionId?: string;
  email?: string | null;
  emailVerifiedAt?: Date | null;
  nickname?: string | null;
  avatar?: string | null;
  rawProfile?: Prisma.InputJsonValue;
}
