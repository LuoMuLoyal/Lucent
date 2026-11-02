/**
 * Ports for the OAuth facade (`application/ports`, ADR-0024).
 *
 * The facade orchestrates three collaborators that each reach infrastructure
 * (Redis state store, Prisma identity rows, notification sender). Declaring
 * their contracts here keeps `application/` depending on the shapes, not on
 * `infrastructure/oauth/*`; the module binds the implementations.
 */

import type { Result, ResultAsync } from '../../../../common/result/index.js';
import type { DomainFailure } from '../../../../common/result/index.js';
import type { User } from '#generated/prisma/client.js';
import type { OAuthProviderProfile } from './oauth-provider.js';
import type {
  OAuthProviderName,
  OAuthStateEntry,
} from '../../types/oauth.types.js';

/** DI tokens; the interfaces themselves live below. */
export const OAUTH_STATE_PORT = 'OAUTH_STATE_PORT';
export const OAUTH_IDENTITIES_PORT = 'OAUTH_IDENTITIES_PORT';
export const OAUTH_NOTIFICATIONS_PORT = 'OAUTH_NOTIFICATIONS_PORT';

/** Single-use OAuth state (CSRF token) lifecycle. */
export interface OAuthStatePort {
  createState(
    provider: OAuthProviderName,
    purpose: OAuthStateEntry['purpose'],
    callbackUri?: string,
  ): ResultAsync<{ state: string; ttlSec: number }, DomainFailure>;

  consume(
    provider: OAuthProviderName,
    state: string,
    purpose: OAuthStateEntry['purpose'],
  ): ResultAsync<OAuthStateEntry, DomainFailure>;

  peek(
    provider: OAuthProviderName,
    state: string,
  ): ResultAsync<OAuthStateEntry, DomainFailure>;

  buildRedirectUrl(
    entry: OAuthStateEntry,
    code: string,
    state: string,
  ): Result<string, DomainFailure>;
}

/** OAuth identity row read/write. */
export interface OAuthIdentitiesPort {
  findOrCreateOAuthUser(
    profile: OAuthProviderProfile,
  ): ResultAsync<User, DomainFailure>;

  updateOAuthLoginUser(
    user: User,
    profile: OAuthProviderProfile,
  ): ResultAsync<User, DomainFailure>;

  linkOAuthProfileToUser(
    userId: string,
    profile: OAuthProviderProfile,
  ): ResultAsync<void, DomainFailure>;
}

/** Best-effort user-facing notices around OAuth sign-in. */
export interface OAuthNotificationsPort {
  notifyOAuthLogin(
    userId: string,
    profile: OAuthProviderProfile,
    locale?: string,
  ): Promise<void>;

  notifyIdentityLinked(
    userId: string,
    profile: OAuthProviderProfile,
    locale?: string,
  ): Promise<void>;
}
