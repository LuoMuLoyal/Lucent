import { Injectable } from '@nestjs/common';

import { normalizeEmail, now } from '../../../../common/index.js';
import {
  createDomainFailure,
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
import { AuthRateLimitService } from './rate-limit.service.js';
import { VerificationCodeService } from './verification-code.service.js';

/**
 * Narrow subset of Better Auth / better-call API errors that we intentionally
 * map to Lucent DomainFailures.  Anything else is re-thrown so it surfaces
 * with its real dependency/internal semantics.
 */
interface BetterAuthAPIError {
  statusCode: number;
  body?: {
    code?: string;
    message?: string;
  };
}

function isBetterAuthAPIError(error: unknown): error is BetterAuthAPIError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  );
}

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
        this.fromBetterAuth(
          this.betterAuthAdapter.auth.api.signUpEmail({
            body: { email, password: dto.password, name },
          }),
        ),
      )
      .andThen((result) => this.lift(this.userService.findById(result.user.id)))
      .andThen((user) => {
        if (!user) {
          // Better Auth returned a synthetic user because the email already
          // exists.  Deliberately the same code as other credential failures —
          // never reveal that the email is registered.
          return errAsync(this.credentialsInvalidFailure());
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
   * Wraps a Better Auth `auth.api.*` promise into a `ResultAsync` and maps
   * every Better Auth API error to a Lucent `DomainFailure`.  Non-Better Auth
   * exceptions (e.g. DB/network) are mapped to `DEPENDENCY_UNAVAILABLE` so they
   * are surfaced through the Result instead of becoming unhandled rejections.
   */
  private fromBetterAuth<T>(
    promise: Promise<T>,
  ): ResultAsync<T, DomainFailure> {
    return fromPromise(promise, (error) => {
      if (isBetterAuthAPIError(error)) {
        return this.mapBetterAuthError(error);
      }
      return mapUnknownToDependencyFailure(error, 'Better Auth call failed');
    });
  }

  /**
   * Maps Better Auth API error codes to Lucent Problem Details codes.
   * Authentication failures are folded into the generic anti-enumeration code.
   *
   * Every Better Auth API error is mapped to a business DomainFailure:
   * known codes above are handled explicitly, unknown 4xx responses become
   * `AUTH_WRONG_PASSWORD` for anti-enumeration, and unknown 5xx responses become
   * `DEPENDENCY_UNAVAILABLE`. Non-Better-Auth exceptions (DB/network/etc.) are
   * mapped to `DEPENDENCY_UNAVAILABLE` by `fromBetterAuth` so they stay inside
   * the Result channel.
   */
  private mapBetterAuthError(error: BetterAuthAPIError): DomainFailure {
    const code = error.body?.code;
    switch (code) {
      // Anti-enumeration bucket: never reveal whether the account exists,
      // whether it has a password, or whether the email is registered.
      case 'USER_ALREADY_EXISTS':
      case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      case 'INVALID_EMAIL_OR_PASSWORD':
      case 'USER_NOT_FOUND':
      case 'INVALID_PASSWORD':
      case 'INVALID_EMAIL':
      case 'USER_EMAIL_NOT_FOUND':
      case 'ACCOUNT_NOT_FOUND':
      case 'CREDENTIAL_ACCOUNT_NOT_FOUND':
      case 'EMAIL_NOT_VERIFIED':
        return this.credentialsInvalidFailure();
      case 'USER_ALREADY_HAS_PASSWORD':
      case 'PASSWORD_ALREADY_SET':
        return createDomainFailure({
          kind: 'conflict',
          code: 'RESOURCE_CONFLICT',
        });
      case 'EMAIL_CAN_NOT_BE_UPDATED':
      case 'CHANGE_EMAIL_DISABLED':
        return createDomainFailure({
          kind: 'validation',
          code: 'VALIDATION_FAILED',
        });
      case 'INVALID_TOKEN':
      case 'TOKEN_EXPIRED':
        return createDomainFailure({
          kind: 'authentication',
          code: 'AUTH_VERIFICATION_CODE_EXPIRED',
        });
      case 'PASSWORD_TOO_SHORT':
      case 'PASSWORD_TOO_LONG':
      case 'VALIDATION_ERROR':
      case 'MISSING_FIELD':
        return createDomainFailure({
          kind: 'validation',
          code: 'VALIDATION_FAILED',
        });
      // Configuration/disabled errors: the method is unavailable, not an
      // internal crash.  Map to a non-500 dependency failure.
      case 'EMAIL_PASSWORD_SIGN_UP_DISABLED':
      case 'EMAIL_PASSWORD_DISABLED':
      case 'RESET_PASSWORD_DISABLED':
      case 'VERIFICATION_EMAIL_NOT_ENABLED':
        return createDomainFailure({
          kind: 'dependency',
          code: 'AUTH_METHOD_DISABLED',
        });
      default:
        // Any other Better Auth API error is treated as an auth-specific
        // failure rather than leaking as a raw 500.  Better Auth 5xx responses
        // are considered dependency failures; everything else is folded into
        // the anti-enumeration bucket.
        if (error.statusCode >= 500) {
          return createDomainFailure({
            kind: 'dependency',
            code: 'DEPENDENCY_UNAVAILABLE',
          });
        }
        return this.credentialsInvalidFailure();
    }
  }

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
          valid ? okAsync(user) : errAsync(this.credentialsInvalidFailure()),
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
      .andThen(() => errAsync(this.credentialsInvalidFailure()));
  }

  private credentialsInvalidFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'authentication',
      code: 'AUTH_WRONG_PASSWORD',
    });
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
