import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import * as argon2 from 'argon2';

import { normalizeEmail, now } from '../../../../common';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result';
import { ARGON2_OPTIONS } from '../../config/argon2-options';
import { NotificationsService } from '../../../notifications';
import type { User } from '#generated/prisma/client';
import { UserStatus } from '#generated/prisma/client';
import { UserService } from '../../../user';
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
    private readonly notificationsService: NotificationsService,
    private readonly i18n: I18nService,
  ) {}

  // ── Registration ─────────────────────────────────────────────

  register(
    dto: RegisterDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    const email = normalizeEmail(dto.email);

    // Anti-enumeration: the verification code is validated before the
    // email-existence check, so probing the endpoint cannot distinguish an
    // already-registered email from a wrong code (both look identical unless
    // a valid code is supplied).
    return this.verificationCodeService
      .verify(email, dto.code, 'register')
      .andThen(() => this.lift(this.userService.findByEmail(email)))
      .andThen((exists) => {
        if (exists) {
          // Deliberately the same code as other credential failures — never
          // reveal that the email is already registered.
          return errAsync(this.credentialsInvalidFailure());
        }

        return this.lift(argon2.hash(dto.password, ARGON2_OPTIONS))
          .andThen((passwordHash) =>
            this.lift(
              this.userService.create({
                email,
                passwordHash,
                nickname: dto.nickname ?? null,
                emailVerifiedAt: now(),
                profile: { create: {} },
              }),
            ),
          )
          .andThen((user) =>
            this.authTokenService
              .generateTokenPair(user, context)
              .map((tokens) => ({ user, ...tokens })),
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
    return this.getActiveUser(userId).andThen((user) => {
      if (!user.passwordHash) {
        return errAsync(this.credentialsInvalidFailure());
      }

      return this.verifyArgon2Password(user, dto.oldPassword)
        .andThen(() => this.lift(argon2.hash(dto.newPassword, ARGON2_OPTIONS)))
        .andThen((passwordHash) =>
          this.userService.update(userId, { passwordHash }),
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
      if (user.passwordHash) {
        return errAsync(
          createDomainFailure({
            kind: 'conflict',
            code: 'RESOURCE_CONFLICT',
          }),
        );
      }

      const targetEmail = dto.email
        ? normalizeEmail(dto.email)
        : user.email
          ? normalizeEmail(user.email)
          : null;

      if (!targetEmail) {
        return errAsync(
          createDomainFailure({
            kind: 'validation',
            code: 'VALIDATION_FAILED',
          }),
        );
      }

      return this.verificationCodeService
        .verify(targetEmail, dto.code, 'set-password')
        .andThen(() => {
          if (!user.email) {
            return this.lift(this.userService.findByEmail(targetEmail)).andThen(
              (existingUser) => {
                if (existingUser && existingUser.id !== userId) {
                  return errAsync(
                    createDomainFailure({
                      kind: 'conflict',
                      code: 'RESOURCE_CONFLICT',
                    }),
                  );
                }
                return this.userService
                  .update(userId, {
                    email: targetEmail,
                    emailVerifiedAt: now(),
                  })
                  .map(() => undefined);
              },
            );
          }
          return okAsync(undefined);
        })
        .andThen(() => this.lift(argon2.hash(dto.password, ARGON2_OPTIONS)))
        .andThen((passwordHash) =>
          this.userService
            .update(userId, { passwordHash })
            .map(() => undefined),
        )
        .andThen(() => this.authTokenService.revokeAll(userId))
        .andThen(() => this.lift(this._notifyPasswordChanged(userId)));
    });
  }

  // ── Email Management ─────────────────────────────────────────

  changeEmail(
    userId: string,
    dto: ChangeEmailDto,
  ): ResultAsync<User, DomainFailure> {
    const newEmail = normalizeEmail(dto.newEmail);

    return this.getActiveUser(userId)
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
    return this.verificationCodeService
      .send(normalizeEmail(dto.email), dto.scene, clientKey)
      .map(() => ({ message: this.i18n.t('auth.verification_code_sent') }));
  }

  verifyEmail(dto: VerifyEmailDto): ResultAsync<void, DomainFailure> {
    const email = normalizeEmail(dto.email);

    return this.verificationCodeService
      .verify(email, dto.code, 'register')
      .andThen(() =>
        this.lift(
          this.userService.updateByEmail(email, {
            emailVerifiedAt: now(),
          }),
        ),
      )
      .map(() => undefined);
  }

  // ── Password Reset ───────────────────────────────────────────

  forgotPassword(
    dto: ForgotPasswordDto,
    clientKey?: string,
  ): ResultAsync<{ message: string }, DomainFailure> {
    const email = normalizeEmail(dto.email);

    return this.verificationCodeService
      .assertClientRateLimit(clientKey)
      .andThen(() => this.lift(this.userService.findByEmail(email)))
      .andThen((user) => {
        if (!user) {
          // Anti-enumeration: identical success response whether or not the
          // account exists.
          return okAsync(undefined);
        }
        return this.verificationCodeService.send(email, 'reset-password');
      })
      .map(() => ({ message: this.i18n.t('auth.forgot_password_hint') }));
  }

  resetPassword(dto: ResetPasswordDto): ResultAsync<void, DomainFailure> {
    const email = normalizeEmail(dto.email);

    return this.verificationCodeService
      .verify(email, dto.code, 'reset-password')
      .andThen(() => this.lift(this.userService.findByEmail(email)))
      .andThen((user) => {
        if (!user) {
          return errAsync(
            createDomainFailure({
              kind: 'not_found',
              code: 'RESOURCE_NOT_FOUND',
            }),
          );
        }
        return this.lift(argon2.hash(dto.password, ARGON2_OPTIONS))
          .andThen((passwordHash) =>
            this.userService.update(user.id, { passwordHash }),
          )
          .andThen(() => this.authTokenService.revokeAll(user.id));
      });
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
      if (!user.passwordHash) {
        return this.recordLoginFailure(email);
      }
      // A wrong password must still count against the login failure rate
      // limit before failing generically. A thrown Argon2 failure (malformed
      // hash, native binding, module/config fault) rethrows without counting.
      return this.verifyArgon2Password(user, dto.password as string)
        .map(() => user)
        .orElse((failure) =>
          this.recordLoginFailure(email).andThen(() => errAsync(failure)),
        );
    }

    return this.verificationCodeService
      .verify(email, dto.code as string, 'login')
      .map(() => user);
  }

  /**
   * Verifies a password against the stored Argon2 hash. A hash mismatch
   * (`argon2.verify` returning `false`) maps to `AUTH_WRONG_PASSWORD`. A
   * thrown Argon2 failure (malformed or corrupted stored hash, native
   * binding error, module/config fault) is re-thrown so it surfaces as a
   * dependency/internal error at the boundary instead of being folded into
   * a business failure; the underlying error is logged for observability.
   */
  private verifyArgon2Password(
    user: User,
    password: string,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(
      argon2.verify(user.passwordHash as string, password),
      (error) => {
        this.logger.warn(
          `argon2.verify threw for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      },
    ).andThen((valid) => {
      if (!valid) {
        return errAsync(this.credentialsInvalidFailure());
      }
      return okAsync(undefined);
    });
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
      await this.notificationsService.create(userId, {
        type: 'password_changed',
        title: this.i18n.t('auth.password_changed_notification_title'),
        content: this.i18n.t('auth.password_changed_notification_content'),
        action: '/account',
      });
    } catch (error) {
      this.logger.error('Notification delivery failed during password change', {
        userId,
        event: 'password_change_notification_failed',
        error,
      });
    }
  }

  /**
   * Lifts non-Prisma IO (Argon2, token service, user lookups, notification
   * best-effort) into `ResultAsync`. Unknown exceptions and dependency-level
   * failures are re-thrown, never converted into a DomainFailure, so they
   * keep their real dependency/internal semantics.
   */
  private lift<T>(promise: Promise<T>): ResultAsync<T, DomainFailure> {
    return fromPromise(promise, (error) => {
      throw error;
    });
  }
}
