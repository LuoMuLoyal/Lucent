import type { Prisma } from '../../generated/prisma/client';

export const OAUTH_PROVIDER_WECHAT_WEB = 'wechat_web';
export const OAUTH_PROVIDER_WECHAT_MOBILE = 'wechat_mobile';

// TODO(auth-oauth): add more providers such as Apple or Google when product scope requires them.
// blocked: each provider needs platform developer credentials (Apple Developer Program, Google Cloud Console) and app review.
export type OAuthProvider =
  | typeof OAUTH_PROVIDER_WECHAT_WEB
  | typeof OAUTH_PROVIDER_WECHAT_MOBILE;

export interface OAuthAuthorizeResult {
  authorizeUrl: string;
  state: string;
  expiresIn: number;
  callbackUri?: string;
}

export interface OAuthProfile {
  provider: OAuthProvider;
  providerUserId: string;
  unionId?: string;
  email?: string | null;
  emailVerifiedAt?: Date | null;
  nickname?: string | null;
  avatar?: string | null;
  rawProfile?: Prisma.InputJsonValue;
}
