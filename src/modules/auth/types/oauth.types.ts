import type { Prisma } from '../../../generated/prisma/client';

export const OAUTH_PROVIDER_WECHAT_WEB = 'wechat_web';
export const OAUTH_PROVIDER_WECHAT_MOBILE = 'wechat_mobile';
export const OAUTH_PROVIDER_APPLE = 'apple';
export const OAUTH_PROVIDER_QQ = 'qq';

export type OAuthProviderName =
  | typeof OAUTH_PROVIDER_WECHAT_WEB
  | typeof OAUTH_PROVIDER_WECHAT_MOBILE
  | typeof OAUTH_PROVIDER_APPLE
  | typeof OAUTH_PROVIDER_QQ;

export interface OAuthAuthorizeResult {
  authorizeUrl: string;
  state: string;
  expiresIn: number;
  callbackUri?: string;
}

export interface OAuthProfile {
  provider: OAuthProviderName;
  providerUserId: string;
  unionId?: string;
  email?: string | null;
  emailVerifiedAt?: Date | null;
  nickname?: string | null;
  avatar?: string | null;
  rawProfile?: Prisma.InputJsonValue;
}
