import type { OAuthProfile, OAuthProviderName } from '../types/oauth.types';

export interface OAuthProvider {
  readonly provider: OAuthProviderName;

  /**
   * OAuth 2.0 code flow: generate the authorization redirect URL.
   * Providers that use native UI (e.g. Apple, WeChat Mobile) should leave this undefined.
   */
  buildAuthorizeUrl?(
    state: string,
    callbackUri?: string,
  ): string | Promise<string>;

  /** Exchange the frontend credential for a unified OAuthProfile. */
  fetchProfile(credential: Record<string, unknown>): Promise<OAuthProfile>;
}
