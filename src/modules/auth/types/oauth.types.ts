export const OAUTH_PROVIDER_WECHAT_WEB = 'wechat_web';
export const OAUTH_PROVIDER_WECHAT_MOBILE = 'wechat_mobile';
export const OAUTH_PROVIDER_APPLE = 'apple';
export const OAUTH_PROVIDER_QQ = 'qq';
export const OAUTH_PROVIDER_GOOGLE = 'google';

export type OAuthProviderName =
  | typeof OAUTH_PROVIDER_WECHAT_WEB
  | typeof OAUTH_PROVIDER_WECHAT_MOBILE
  | typeof OAUTH_PROVIDER_APPLE
  | typeof OAUTH_PROVIDER_QQ
  | typeof OAUTH_PROVIDER_GOOGLE;

export interface OAuthAuthorizeResult {
  authorizeUrl: string;
  state: string;
  expiresIn: number;
  callbackUri?: string;
}

/** One in-flight OAuth authorization: which provider, why, and where back. */
export interface OAuthStateEntry {
  provider: OAuthProviderName;
  purpose: 'login' | 'link';
  callbackUri?: string;
}
