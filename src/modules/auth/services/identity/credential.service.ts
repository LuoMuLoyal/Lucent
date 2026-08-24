import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { randomUUID } from 'node:crypto';

import { normalizeEmail, now } from '../../../../common';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result';
import type { User } from '#generated/prisma/client';
import { UserStatus } from '#generated/prisma/client';
import { PrismaService } from '../../../../prisma';
import { UserService } from '../../../user';
import { AuthBetterAuthAdapter } from '../../adapters/better-auth.adapter';
import { NotificationsService } from '../../../notifications';
import { VerificationCodeService } from './verification-code.service';
import { RegisterDto } from '../../dto/credentials/register.dto';
import { LoginDto } from '../../dto/credentials/login.dto';
import { ChangePasswordDto } from '../../dto/password/change-password.dto';
import { ChangeEmailDto } from '../../dto/password/change-email.dto';
import { ResetPasswordDto } from '../../dto/password/reset-password.dto';
import { SetPasswordDto } from '../../dto/password/set-password.dto';
import { ForgotPasswordDto } from '../../dto/password/forgot-password.dto';
import { SendVerificationCodeDto } from '../../dto/password/send-verification-code.dto';
import { VerifyEmailDto } from '../../dto/password/verify-email.dto';
import {
  AuthTokenService,
  type AuthRequestContext,
  type TokenPair,
} from '../token.service';
import { AuthRateLimitService } from './rate-limit.service';
import { PasswordReauthService } from './password-reauth.service';

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
 * Handles email/password credential flows: registration, login,
 * password changes, email changes, password reset, and verification codes.
 *
 * All expected business failures are expressed as
 * `ResultAsync<T, DomainFailure>`. Unknown exceptions, config errors and
 * dependency-level failures (Argon2 hashing, DB, token signing, cache) are
 * deliberately re-thrown so they keep their real internal/dependency
 * semantics instead of being misreported as wrong credentials.
 */
@Injectable()
export class CredentialAuthService {
  private readonly logger = new Logger(CredentialAuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly authTokenService: AuthTokenService,
    private readonly authRateLimitService: AuthRateLimitService,
    private readonly passwordReauthService: PasswordReauthService,
    private readonly notificationsService: NotificationsService,
    private readonly betterAuthAdapter: AuthBetterAuthAdapter,
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
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

  // ── Password Management ──────────────────────────────────────

  changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): ResultAsync<void, DomainFailure> {
    return this.getActiveUser(userId)
      .andThen(() => this.passwordReauthService.verify(userId, dto.password))
      .andThen(() =>
        this.lift(
          this.prisma.account.findFirst({
            where: {
              userId,
              providerId: this.betterAuthAdapter.credentialProviderId,
            },
          }),
        ),
      )
      .andThen((account) => {
        if (!account) {
          return errAsync(
            createDomainFailure({
              kind: 'authentication',
              code: 'AUTH_PASSWORD_NOT_SET',
            }),
          );
        }

        return this.lift(this.betterAuthAdapter.hashPassword(dto.newPassword))
          .andThen((hashedPassword) =>
            this.lift(
              this.prisma.account.update({
                where: { id: account.id },
                data: { password: hashedPassword },
              }),
            ),
          )
          .andThen(() => this.authTokenService.revokeAll(userId))
          .andThen(() => this.lift(this._notifyPasswordChanged(userId)));
      });
  }

  setPassword(
    userId: string,
    dto: SetPasswordDto,
  ): ResultAsync<void, DomainFailure> {
    return this.getActiveUser(userId).andThen((user) => {
      if (!user.email) {
        return errAsync(
          createDomainFailure({
            kind: 'validation',
            code: 'VALIDATION_FAILED',
          }),
        );
      }

      const email = normalizeEmail(user.email);

      return this.lift(
        this.prisma.account.findFirst({
          where: {
            userId,
            providerId: this.betterAuthAdapter.credentialProviderId,
          },
        }),
      ).andThen((existingAccount) => {
        if (existingAccount) {
          return errAsync(
            createDomainFailure({
              kind: 'conflict',
              code: 'RESOURCE_CONFLICT',
            }),
          );
        }

        return this.verificationCodeService
          .verify(email, dto.code, 'set-password')
          .andThen(() =>
            this.lift(this.betterAuthAdapter.hashPassword(dto.password)),
          )
          .andThen((hashedPassword) =>
            this.lift(
              this.prisma.account.create({
                data: {
                  id: randomUUID(),
                  userId,
                  providerId: this.betterAuthAdapter.credentialProviderId,
                  issuer: this.betterAuthAdapter.credentialIssuer,
                  accountId: userId,
                  password: hashedPassword,
                },
              }),
            ),
          )
          .andThen(() => this.authTokenService.revokeAll(userId))
          .andThen(() => this.lift(this._notifyPasswordChanged(userId)));
      });
    });
  }

  // ── Email Management ─────────────────────────────────────────

  changeEmail(
    userId: string,
    dto: ChangeEmailDto,
  ): ResultAsync<User, DomainFailure> {
    const newEmail = normalizeEmail(dto.newEmail);

    return this.getActiveUser(userId)
      .andThen(() => this.passwordReauthService.verify(userId, dto.password))
      .andThen(() => this.lift(this.userService.findByEmail(newEmail)))
      .andThen((exists) => {
        if (exists) {
          return errAsync(
            createDomainFailure({
              kind: 'conflict',
              code: 'RESOURCE_CONFLICT',
            }),
          );
        }
        // The code here is the product-level anti-abuse verification code;
        // Better Auth email-verification / password-reset tokens are handled
        // by verifyEmail, forgotPassword, and resetPassword instead.
        return this.verificationCodeService
          .verify(newEmail, dto.code, 'change-email')
          .andThen(() =>
            this.userService.update(userId, {
              email: newEmail,
              emailVerifiedAt: now(),
            }),
          );
      });
  }

  // ── Verification Code ────────────────────────────────────────

  sendVerificationCode(
    dto: SendVerificationCodeDto,
    clientKey?: string,
  ): ResultAsync<{ message: string }, DomainFailure> {
    // This code is a product-level anti-abuse verification code stored in
    // cache; it is unrelated to Better Auth's Verification table tokens.
    return this.verificationCodeService
      .send(normalizeEmail(dto.email), dto.scene, clientKey)
      .map(() => ({ message: this.i18n.t('auth.verification_code_sent') }));
  }

  verifyEmail(dto: VerifyEmailDto): ResultAsync<void, DomainFailure> {
    return this.fromBetterAuth(
      this.betterAuthAdapter.auth.api.verifyEmail({
        query: { token: dto.token },
      }),
    ).map(() => undefined);
  }

  // ── Password Reset ───────────────────────────────────────────

  forgotPassword(
    dto: ForgotPasswordDto,
    clientKey?: string,
  ): ResultAsync<{ message: string }, DomainFailure> {
    const email = normalizeEmail(dto.email);

    return this.verificationCodeService
      .assertClientRateLimit(clientKey)
      .andThen(() =>
        this.fromBetterAuth(
          this.betterAuthAdapter.auth.api.requestPasswordReset({
            body: {
              email,
              redirectTo: this.betterAuthAdapter.getEmailCallbackUrl(),
            },
          }),
        ),
      )
      .map(() => ({ message: this.i18n.t('auth.forgot_password_hint') }));
  }

  resetPassword(dto: ResetPasswordDto): ResultAsync<void, DomainFailure> {
    const identifier = `reset-password:${dto.token}`;

    // Pre-check: Better Auth's resetPassword consumes the token and does not
    // return the user id, but Lucent must revoke all JWT sessions after a
    // successful reset. Resolving userId before the token is consumed is
    // therefore a necessary business guard.
    // The find-then-consume flow is intentionally non-atomic because the token
    // is single-use; a concurrent consume is acceptable and surfaces as
    // AUTH_VERIFICATION_CODE_EXPIRED.
    return this.lift(
      this.prisma.verification.findFirst({ where: { identifier } }),
    ).andThen((verification) => {
      if (!verification) {
        return errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_VERIFICATION_CODE_EXPIRED',
          }),
        );
      }

      const userId = verification.value;

      return this.fromBetterAuth(
        this.betterAuthAdapter.auth.api.resetPassword({
          body: { token: dto.token, newPassword: dto.password },
        }),
      )
        .andThen(() => this.authTokenService.revokeAll(userId))
        .map(() => undefined);
    });
  }

  // ── Helpers ──────────────────────────────────────────────────

  /**
   * Wraps a Better Auth `auth.api.*` promise into a `ResultAsync` and maps
   * every Better Auth API error to a Lucent `DomainFailure`.  Non-Better Auth
   * exceptions (e.g. DB/network) are re-thrown so they keep their dependency
   * semantics.
   */
  private fromBetterAuth<T>(
    promise: Promise<T>,
  ): ResultAsync<T, DomainFailure> {
    return fromPromise(promise, (error) => {
      if (isBetterAuthAPIError(error)) {
        return this.mapBetterAuthError(error);
      }
      throw error;
    });
  }

  /**
   * Maps Better Auth API error codes to Lucent Problem Details codes.
   * Authentication failures are folded into the generic anti-enumeration code.
   *
   * Every Better Auth API error is mapped to a business DomainFailure:
   * known codes above are handled explicitly, unknown 4xx responses become
   * `AUTH_WRONG_PASSWORD` for anti-enumeration, and unknown 5xx responses become
   * `DEPENDENCY_UNAVAILABLE`. Only non-Better-Auth exceptions (DB/network/etc.)
   * are re-thrown so they keep their real dependency/internal semantics.
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
      return this.betterAuthAdapter
        .verifyPasswordForUser(user.id, dto.password as string)
        .andThen((valid) =>
          valid ? okAsync(user) : errAsync(this.credentialsInvalidFailure()),
        )
        .orElse(() => this.recordLoginFailure(email));
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

  private getActiveUser(userId: string): ResultAsync<User, DomainFailure> {
    return this.lift(this.userService.findById(userId)).andThen((user) => {
      if (!user) {
        return errAsync(
          createDomainFailure({
            kind: 'not_found',
            code: 'RESOURCE_NOT_FOUND',
          }),
        );
      }
      return okAsync(user);
    });
  }

  private async _notifyPasswordChanged(userId: string): Promise<void> {
    try {
      const result = await this.notificationsService.create(userId, {
        type: 'password_changed',
        title: this.i18n.t('auth.password_changed_notification_title'),
        content: this.i18n.t('auth.password_changed_notification_content'),
        action: '/account',
      });
      if (result.isErr()) {
        this.logger.error(
          'Notification delivery failed during password change',
          {
            userId,
            event: 'password_change_notification_failed',
            error: result.error,
          },
        );
      }
    } catch (error) {
      this.logger.error('Notification delivery failed during password change', {
        userId,
        event: 'password_change_notification_failed',
        error,
      });
    }
  }

  /**
   * Lifts non-Prisma IO (Better Auth calls, Argon2 callbacks, token service,
   * user lookups, notification best-effort) into `ResultAsync`. Unknown
   * exceptions and dependency-level failures are re-thrown, never converted
   * into a DomainFailure, so they keep their real dependency/internal
   * semantics.
   */
  private lift<T>(promise: Promise<T>): ResultAsync<T, DomainFailure> {
    return fromPromise(promise, (error) => {
      throw error;
    });
  }
}
