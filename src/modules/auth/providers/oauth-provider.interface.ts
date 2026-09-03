import type {
  ResultAsync,
  DomainFailure,
} from '../../../common/result/index.js';
import type { OAuthProfile, OAuthProviderName } from '../types/oauth.types.js';

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

  /**
   * Exchange the frontend credential for a unified OAuthProfile.
   *
   * Expected recoverable failures are returned as a DomainFailure:
   * - `VALIDATION_FAILED` — the client credential is missing or malformed.
   * - `DEPENDENCY_TIMEOUT` / `DEPENDENCY_UNAVAILABLE` / `DEPENDENCY_BAD_GATEWAY`
   *   — upstream HTTP, token exchange, JWKS or profile decoding failures.
   *
   * Configuration errors (missing appId/secret/redirectUri), programming
   * errors and unknown exceptions are thrown, never folded into the Result.
   */
  fetchProfile(
    credential: Record<string, unknown>,
  ): ResultAsync<OAuthProfile, DomainFailure>;
}
