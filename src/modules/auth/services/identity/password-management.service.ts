import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { randomUUID } from 'node:crypto';

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
import { PrismaService } from '../../../../prisma/index.js';
import { UserService } from '../../../user/index.js';
import { AuthBetterAuthAdapter } from '../../adapters/better-auth.adapter.js';
import { INotificationSender } from '../../../notifications/index.js';
import { VerificationCodeService } from './verification-code.service.js';
import type { ChangePasswordDto } from '../../dto/password/change-password.dto.js';
import type { ChangeEmailDto } from '../../dto/password/change-email.dto.js';
import type { ResetPasswordDto } from '../../dto/password/reset-password.dto.js';
import type { SetPasswordDto } from '../../dto/password/set-password.dto.js';
import type { ForgotPasswordDto } from '../../dto/password/forgot-password.dto.js';
import type { SendVerificationCodeDto } from '../../dto/password/send-verification-code.dto.js';
import type { VerifyEmailDto } from '../../dto/password/verify-email.dto.js';
import { AuthTokenService } from '../token.service.js';
import { fromBetterAuth } from './better-auth-error.js';
import { PasswordReauthService } from './password-reauth.service.js';

/**
 * Handles password management flows: password changes, email changes,
 * verification codes, and password reset.
 *
 * All expected business failures are expressed as
 * `ResultAsync<T, DomainFailure>`. Unknown exceptions, config errors and
 * dependency-level failures (Argon2 hashing, DB, token signing, cache) are
 * returned as `internal` or `dependency` DomainFailures so they keep their
 * real semantics instead of being misreported as wrong credentials.
 */
@Injectable()
export class PasswordManagementService {
  private readonly logger = new Logger(PasswordManagementService.name);

  constructor(
    private readonly userService: UserService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly authTokenService: AuthTokenService,
    private readonly passwordReauthService: PasswordReauthService,
    private readonly notificationsService: INotificationSender,
    private readonly betterAuthAdapter: AuthBetterAuthAdapter,
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

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
          .andThen(() => {
            // Fire-and-forget: the notification is best-effort and must never
            // fail the password change after the DB write already committed.
            void this._notifyPasswordChanged(userId);
            return okAsync(undefined);
          });
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
          .andThen(() => {
            void this._notifyPasswordChanged(userId);
            return okAsync(undefined);
          });
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
    locale?: string,
  ): ResultAsync<{ message: string }, DomainFailure> {
    // This code is a product-level anti-abuse verification code stored in
    // cache; it is unrelated to Better Auth's Verification table tokens.
    return this.verificationCodeService
      .send(normalizeEmail(dto.email), dto.scene, clientKey, locale)
      .map(() => ({
        message: locale
          ? this.i18n.t('auth.verification_code_sent', { lang: locale })
          : this.i18n.t('auth.verification_code_sent'),
      }));
  }

  verifyEmail(dto: VerifyEmailDto): ResultAsync<void, DomainFailure> {
    return fromBetterAuth(
      this.betterAuthAdapter.auth.api.verifyEmail({
        query: { token: dto.token },
      }),
      'Better Auth call failed',
    ).map(() => undefined);
  }

  // ── Password Reset (verification-code mode) ──────────────────

  forgotPassword(
    dto: ForgotPasswordDto,
    clientKey?: string,
    locale?: string,
  ): ResultAsync<{ message: string }, DomainFailure> {
    const email = normalizeEmail(dto.email);

    // Same product-level verification-code flow as register / set-password.
    // Anti-enumeration: the code is always reported as sent regardless of
    // whether the email is registered, so probing cannot distinguish a
    // registered from an unregistered address.
    return this.verificationCodeService
      .send(email, 'forgot-password', clientKey, locale)
      .map(() => ({
        message: locale
          ? this.i18n.t('auth.forgot_password_hint', { lang: locale })
          : this.i18n.t('auth.forgot_password_hint'),
      }));
  }

  resetPassword(dto: ResetPasswordDto): ResultAsync<void, DomainFailure> {
    const email = normalizeEmail(dto.email);

    // Resolve the user from the email before consuming the one-time code so
    // Lucent can revoke all JWT sessions after a successful reset. The code
    // is single-use: a concurrent consume surfaces as AUTH_VERIFICATION_CODE_EXPIRED.
    return this.lift(this.userService.findByEmail(email)).andThen((user) => {
      if (!user) {
        // Anti-enumeration: same generic failure as a wrong/expired code —
        // never reveal whether the email is registered.
        return errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_VERIFICATION_CODE_EXPIRED',
          }),
        );
      }

      const userId = user.id;

      return this.verificationCodeService
        .verify(email, dto.code, 'forgot-password')
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
            // OAuth-only account without a local credential — nothing to reset.
            return errAsync(
              createDomainFailure({
                kind: 'authentication',
                code: 'AUTH_PASSWORD_NOT_SET',
              }),
            );
          }

          return this.lift(this.betterAuthAdapter.hashPassword(dto.password))
            .andThen((hashedPassword) =>
              this.lift(
                this.prisma.account.update({
                  where: { id: account.id },
                  data: { password: hashedPassword },
                }),
              ),
            )
            .andThen(() => this.authTokenService.revokeAll(userId))
            .andThen(() => {
              void this._notifyPasswordChanged(userId);
              return okAsync(undefined);
            });
        });
    });
  }

  // ── Helpers ──────────────────────────────────────────────────

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

  /**
   * Best-effort notification that a password was changed.
   *
   * The notification has no delivery SLA: failures are logged only — the
   * password change itself already succeeded, so a failed notification is
   * **not** retried and does **not** raise an alert. Callers must not await
   * or propagate failures. Invoked via
   * `void this._notifyPasswordChanged(userId)` (fire-and-forget) after the
   * DB write and session revocation have already succeeded. If a delivery
   * SLA is ever required, layer an Outbox pattern on `INotificationSender`
   * instead of changing this contract.
   */
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
