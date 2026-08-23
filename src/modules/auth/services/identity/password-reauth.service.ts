import { Injectable } from '@nestjs/common';

import {
  createDomainFailure,
  errAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result';
import { AuthBetterAuthAdapter } from '../../adapters/better-auth.adapter';
import { AuthRateLimitService } from './rate-limit.service';

/**
 * Verifies the user's current password for sensitive operations. It combines
 * Redis-based rate limiting with Better Auth credential verification and emits
 * the domain failures expected by the API boundary:
 *
 * - `AUTH_PASSWORD_NOT_SET` — the user has no local credential account.
 * - `AUTH_WRONG_PASSWORD` — the supplied password does not match.
 * - `RATE_LIMITED` — too many consecutive failures (carries `retryAfter`).
 */
@Injectable()
export class PasswordReauthService {
  constructor(
    private readonly betterAuthAdapter: AuthBetterAuthAdapter,
    private readonly rateLimitService: AuthRateLimitService,
  ) {}

  /**
   * Verifies `password` for `userId`. Returns `okAsync(undefined)` on success
   * and clears any previous re-authentication failures.
   */
  verify(userId: string, password: string): ResultAsync<void, DomainFailure> {
    return this.rateLimitService
      .checkReauthRateLimit(userId)
      .andThen(() =>
        this.betterAuthAdapter.verifyPasswordForUser(userId, password),
      )
      .andThen((valid) => {
        if (!valid) {
          return this.rateLimitService.recordReauthFailure(userId).andThen(() =>
            errAsync(
              createDomainFailure({
                kind: 'authentication',
                code: 'AUTH_WRONG_PASSWORD',
              }),
            ),
          );
        }
        return this.rateLimitService.clearReauthFailures(userId);
      });
  }
}
