import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { betterAuth, type Auth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import * as argon2 from 'argon2';
import type { Prisma } from '#generated/prisma/client';

import { PrismaService } from '../../../prisma/prisma.service.js';
import { EnvKey } from '../../../config/env/env-keys.enum.js';
import { ARGON2_OPTIONS } from '../config/argon2-options.js';
import { MailService } from '../../../mail/mail.service.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
  mapUnknownToInternalFailure,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';

const DEFAULT_EMAIL_CALLBACK_URL = 'luminous://auth/callback';

export const CREDENTIAL_PROVIDER_ID = 'credential';
export const LOCAL_CREDENTIAL_ISSUER = 'local:credential';

/**
 * Providers that Better Auth treats as "trusted" — it will automatically
 * link new social accounts to existing users without requiring an explicit
 * account-linking step.  Lucent's OAuth service mirrors this list to reject
 * manual linking of the same providers (they go through the signIn flow).
 *
 * Keep this as the single source of truth; both the Better Auth config and
 * {@link AuthOAuthService.linkOAuthProfileToUser} reference it.
 */
export const BETTER_AUTH_TRUSTED_PROVIDERS = ['apple', 'google'] as const;

/**
 * NestJS adapter wrapping the Better Auth library against Lucent's merged
 * `User` model.  This service is intentionally not exposed as an HTTP route —
 * it only constructs and holds the configured `auth` instance so that later
 * tasks can call `auth.api.*` methods to drive credential and OAuth flows.
 *
 * Field mapping:
 * - Better Auth `name`   -> Lucent `nickname`
 * - Better Auth `image`  -> Lucent `avatar`
 * - Better Auth `emailVerified` already exists on the merged `User` model.
 */
@Injectable()
export class AuthBetterAuthAdapter {
  readonly auth: Auth;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {
    const secret = this.config.get<string>(EnvKey.BETTER_AUTH_SECRET);
    if (!secret) {
      throw new Error(
        `Missing required environment variable: ${EnvKey.BETTER_AUTH_SECRET}`,
      );
    }

    const baseURL =
      this.config.get<string>(EnvKey.BETTER_AUTH_URL)?.trim() ||
      this.config.get<string>(EnvKey.PUBLIC_BASE_URL)?.trim() ||
      'http://localhost:3000';

    this.auth = betterAuth({
      database: prismaAdapter(this.prisma, { provider: 'postgresql' }),
      secret,
      baseURL,
      user: {
        modelName: 'User',
        fields: {
          name: 'nickname',
          image: 'avatar',
        },
      },
      emailAndPassword: {
        enabled: true,
        // Lucent's register flow already verifies the email through its own
        // anti-enumeration verification code.  We therefore keep Better Auth
        // from blocking sign-in for unverified users and from sending its own
        // verification email on sign-up.  The verify-email endpoint is exposed
        // explicitly when needed.
        requireEmailVerification: false,
        autoSignIn: false,
        minPasswordLength: 8,
        maxPasswordLength: 32,
        sendResetPassword: async (data) => {
          await this.mailService.sendPasswordResetLink(
            data.user.email,
            data.url,
          );
        },
        password: {
          hash: async (password: string) =>
            argon2.hash(password, ARGON2_OPTIONS),
          verify: async (data: { hash: string; password: string }) =>
            argon2.verify(data.hash, data.password, ARGON2_OPTIONS),
        },
      },
      emailVerification: {
        sendOnSignUp: false,
        sendVerificationEmail: async (data) => {
          await this.mailService.sendVerificationLink(
            data.user.email,
            data.url,
          );
        },
      },
      socialProviders: this.buildSocialProviders(),
      account: {
        accountLinking: {
          enabled: true,
          trustedProviders: [...BETTER_AUTH_TRUSTED_PROVIDERS],
        },
        updateAccountOnSignIn: true,
      },
      databaseHooks: {
        user: {
          create: {
            after: async (user, _context) => {
              // Better Auth creates the user row directly, so Lucent's
              // UserService.create(profile: { create: {} }) path is bypassed.
              // Ensure every user still has a profile row for downstream
              // modules that assume its existence.
              await this.prisma.userProfile.upsert({
                where: { userId: user.id },
                update: {},
                create: { userId: user.id },
              });
            },
          },
        },
      },
    }) as Auth;
  }

  private buildSocialProviders(): {
    google?: { clientId: string; clientSecret: string };
    apple?: { clientId: string; clientSecret: string };
  } {
    const providers: {
      google?: { clientId: string; clientSecret: string };
      apple?: { clientId: string; clientSecret: string };
    } = {};

    const googleClientId = this.config
      .get<string>(EnvKey.GOOGLE_CLIENT_ID)
      ?.trim();
    const googleClientSecret = this.config
      .get<string>(EnvKey.GOOGLE_CLIENT_SECRET)
      ?.trim();
    if (googleClientId && googleClientSecret) {
      providers.google = {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      };
    }

    const appleClientId = this.config.get<string>(EnvKey.APPLE_APP_ID)?.trim();
    const appleClientSecret = this.config
      .get<string>(EnvKey.APPLE_CLIENT_SECRET)
      ?.trim();
    if (appleClientId && appleClientSecret) {
      providers.apple = {
        clientId: appleClientId,
        clientSecret: appleClientSecret,
      };
    }

    return providers;
  }

  /**
   * Hashes a plain-text password using the same Argon2 configuration Better
   * Auth uses internally.  This lets Lucent facade operations (set/change
   * password) stay consistent with the credential account stored by Better Auth.
   */
  async hashPassword(password: string): Promise<string> {
    return this.auth.options.emailAndPassword?.password?.hash
      ? this.auth.options.emailAndPassword.password.hash(password)
      : argon2.hash(password, ARGON2_OPTIONS);
  }

  /**
   * Verifies a plain-text password against a stored Better Auth credential
   * account hash using the configured Argon2 callback.
   */
  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return this.auth.options.emailAndPassword?.password?.verify
      ? this.auth.options.emailAndPassword.password.verify({ hash, password })
      : argon2.verify(hash, password, ARGON2_OPTIONS);
  }

  /**
   * Finds the local credential account for `userId` and verifies the supplied
   * password. Returns `true` when the password matches. Returns a domain failure
   * with `AUTH_PASSWORD_NOT_SET` when the user has no credential account, so
   * callers can prompt OAuth-only users to set a password first.
   *
   * Wrong passwords are returned as `false`; callers map them to
   * `AUTH_WRONG_PASSWORD` and apply rate-limiting as appropriate.
   */
  verifyPasswordForUser(
    userId: string,
    password: string,
  ): ResultAsync<boolean, DomainFailure> {
    return this.findCredentialAccount(userId).andThen((account) => {
      if (!account?.password) {
        return errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_PASSWORD_NOT_SET',
          }),
        );
      }

      return fromPromise(
        this.verifyPassword(account.password, password),
        (error) =>
          mapUnknownToInternalFailure(error, 'Password verification failed'),
      );
    });
  }

  /**
   * Revokes all Better Auth sessions for a user.  This is a safety belt: any
   * flow that creates a Better Auth session as an internal side effect (or that
   * should invalidate existing ones) calls this so the Better Auth `Session`
   * row can never become a hidden second authentication surface for Luminous.
   *
   * An optional transaction client keeps the cleanup atomic with the caller's
   * Lucent `UserSession` deletion.
   */
  revokeBetterAuthSessions(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): ResultAsync<void, DomainFailure> {
    const client = tx ?? this.prisma;
    return fromPromise(
      client.session.deleteMany({
        where: { userId },
      }),
      (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Failed to revoke Better Auth sessions',
        ),
    ).map(() => undefined);
  }

  /**
   * Returns `true` when the user has a local credential account with a stored
   * password.  This is the single source of truth for "does this user have a
   * password?" now that `User.passwordHash` has been removed.
   */
  hasPassword(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): ResultAsync<boolean, DomainFailure> {
    const client = tx ?? this.prisma;
    return fromPromise(
      client.account.findFirst({
        where: {
          userId,
          providerId: CREDENTIAL_PROVIDER_ID,
        },
        select: { password: true },
      }),
      (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Failed to check credential account',
        ),
    ).map(
      (account) =>
        account?.password !== null && account?.password !== undefined,
    );
  }

  private findCredentialAccount(
    userId: string,
  ): ResultAsync<{ password: string | null } | null, DomainFailure> {
    return fromPromise(
      this.prisma.account.findFirst({
        where: {
          userId,
          providerId: CREDENTIAL_PROVIDER_ID,
        },
        select: { password: true },
      }),
      (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Failed to load credential account',
        ),
    );
  }

  /**
   * Deep-link / web callback URL that Better Auth emails should redirect to
   * after the user interacts with a verification or reset link.  Defaults
   * to the Luminous mobile deep-link scheme.
   */
  getEmailCallbackUrl(): string {
    return (
      this.config.get<string>(EnvKey.BETTER_AUTH_EMAIL_CALLBACK_URL)?.trim() ||
      DEFAULT_EMAIL_CALLBACK_URL
    );
  }

  /** Identifier Better Auth uses for local credential accounts. */
  get credentialProviderId(): string {
    return CREDENTIAL_PROVIDER_ID;
  }

  /** Issuer string stored on local credential accounts. */
  get credentialIssuer(): string {
    return LOCAL_CREDENTIAL_ISSUER;
  }
}
