import { Injectable } from '@nestjs/common';

import { normalizeEmail, now } from '../../../../common/index.js';
import {
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import type { User } from '#generated/prisma/client.js';
import { UserStatus } from '#generated/prisma/client.js';
import { UserService } from '../../../user/index.js';
import { AuthBetterAuthAdapter } from '../../adapters/better-auth.adapter.js';
import type { RegisterDto } from '../../dto/credentials/register.dto.js';
import type { LoginDto } from '../../dto/credentials/login.dto.js';
import {
  AuthTokenService,
  type AuthRequestContext,
  type TokenPair,
} from '../token.service.js';
import {
  credentialsInvalidFailure,
  fromBetterAuth,
} from './better-auth-error.js';
import { AuthRateLimitService } from './rate-limit.service.js';
import { VerificationCodeService } from './verification-code.service.js';

/**
 * Handles email/password credential flows: registration and login.
 *
 * Password management (change/set/reset), email changes and verification
 * codes live in `PasswordManagementService`.
 *
 * All expected business failures are expressed as
 * `ResultAsync<T, DomainFailure>`. Unknown exceptions, config errors and
 * dependency-level failures (Argon2 hashing, DB, token signing, cache) are
 * returned as `internal` or `dependency` DomainFailures so they keep their
 * real semantics instead of being misreported as wrong credentials.
 */
@Injectable()
export class CredentialAuthService {
  constructor(
    private readonly userService: UserService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly authTokenService: AuthTokenService,
    private readonly authRateLimitService: AuthRateLimitService,
    private readonly betterAuthAdapter: AuthBetterAuthAdapter,
  ) {}

  // ── Registration ─────────────────────────────────────────────

  register(
    dto: RegisterDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    const email = normalizeEmail(dto.email);
    const name = dto.nickname?.trim() || email.split('@')[0] || 'User';

    // Anti-enumeration: the verification code is validated before the
    // email-existence check, so probing the endpoint cannot distinguish an
    // already-registered email from a wrong code (both look identical unless
    // a valid code is supplied).
    return this.verificationCodeService
      .verify(email, dto.code, 'register')
      .andThen(() =>
        fromBetterAuth(
          this.betterAuthAdapter.auth.api.signUpEmail({
            body: { email, password: dto.password, name },
          }),
          'Better Auth call failed',
        ),
      )
      .andThen((result) => this.lift(this.userService.findById(result.user.id)))
      .andThen((user) => {
        if (!user) {
          // Better Auth returned a synthetic user because the email already
          // exists.  Deliberately the same code as other credential failures —
          // never reveal that the email is registered.
          return errAsync(credentialsInvalidFailure());
        }
        return this.userService
          .update(user.id, {
            emailVerified: true,
            emailVerifiedAt: now(),
          })
          .andThen((updatedUser) =>
            this.authTokenService
              .generateTokenPair(updatedUser, context)
              .andThen((tokens) =>
                this.betterAuthAdapter
                  .revokeBetterAuthSessions(updatedUser.id)
                  .map(() => ({ user: updatedUser, ...tokens })),
              ),
          );
      });
  }

  // ── Login ────────────────────────────────────────────────────

  login(
    dto: LoginDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    const email = normalizeEmail(dto.email);

    return this.authRateLimitService
      .checkLoginRateLimit(email)
      .andThen(() => this.lift(this.userService.findByEmail(email)))
      .andThen((user) => this.verifyLoginCredentials(email, dto, user))
      .andThen((user) =>
        this.authRateLimitService
          .clearLoginFailures(email)
          .andThen(() =>
            this.userService.update(user.id, {
              lastLoginAt: now(),
              status: UserStatus.active,
            }),
          )
          .andThen((updatedUser) =>
            this.authTokenService
              .generateTokenPair(updatedUser, context)
              .map((tokens) => ({ user: updatedUser, ...tokens })),
          ),
      );
  }

  // ── Helpers ──────────────────────────────────────────────────

  /**
   * Validates the provided password (or verification code) for a login
   * attempt. Every failure path returns the same generic
   * `AUTH_WRONG_PASSWORD` code so the response never reveals whether the
   * account exists, whether it has a password, or whether the credentials
   * were wrong; each failure also records the attempt for rate limiting.
   */
  private verifyLoginCredentials(
    email: string,
    dto: LoginDto,
    user: User | null,
  ): ResultAsync<User, DomainFailure> {
    if (!user) {
      return this.recordLoginFailure(email);
    }

    const hasPassword = dto.password !== undefined;
    const hasCode = dto.code !== undefined;

    if (hasPassword === hasCode) {
      // Both or neither provided — same generic failure as wrong credentials.
      return this.recordLoginFailure(email);
    }

    if (hasPassword) {
      // Verify directly against the Better Auth credential account so this
      // path never creates a Better Auth session.  Both "no credential
      // account" and "wrong password" are folded into the same generic
      // anti-enumeration failure and counted against the rate limit.
      // Internal/dependency failures from the adapter are propagated unchanged
      // so they are not masked as wrong credentials.
      return this.betterAuthAdapter
        .verifyPasswordForUser(user.id, dto.password as string)
        .andThen((valid) =>
          valid ? okAsync(user) : errAsync(credentialsInvalidFailure()),
        )
        .orElse((error) => {
          if (error.kind === 'internal' || error.kind === 'dependency') {
            return errAsync(error);
          }
          return this.recordLoginFailure(email);
        });
    }

    return this.verificationCodeService
      .verify(email, dto.code as string, 'login')
      .map(() => user);
  }

  /**
   * Records a login failure (rate-limit bookkeeping) and returns the unified
   * credential-invalid failure. The record happens first so rate limiting
   * still counts even though the client only ever sees the generic code.
   */
  private recordLoginFailure(email: string): ResultAsync<never, DomainFailure> {
    return this.authRateLimitService
      .recordLoginFailure(email)
      .andThen(() => errAsync(credentialsInvalidFailure()));
  }

  /**
   * Lifts non-Prisma IO (Better Auth calls, Argon2 callbacks, token service,
   * user lookups) into `ResultAsync`. Unknown exceptions are mapped to
   * `DEPENDENCY_UNAVAILABLE` so they stay inside the Result channel instead
   * of becoming unhandled rejections.
   */
  private lift<T>(promise: Promise<T>): ResultAsync<T, DomainFailure> {
    return fromPromise(promise, (error) =>
      mapUnknownToDependencyFailure(error, 'Credential operation failed'),
    );
  }
}
