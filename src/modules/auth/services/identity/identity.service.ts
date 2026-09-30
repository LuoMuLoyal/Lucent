import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import type { Prisma } from '#generated/prisma/client.js';
import { fromPrismaResult } from '../../../../common/index.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { ARGON2_OPTIONS } from '../../config/argon2-options.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
  mapUnknownToInternalFailure,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';

/** `providerId` of the local email+password identity. */
export const CREDENTIAL_PROVIDER_ID = 'credential';

/** `issuer` recorded on local email+password identities. */
export const LOCAL_CREDENTIAL_ISSUER = 'local:credential';

/**
 * Providers whose identities are trusted for automatic account linking: a
 * sign-in through one of these may attach to an existing Lucent user by email
 * without an explicit linking step.
 *
 * Keep this as the single source of truth; {@link AuthOAuthService} references
 * it to reject manual linking of the same providers (they go through sign-in).
 */
export const TRUSTED_IDENTITY_PROVIDERS = ['apple', 'google'] as const;

/**
 * Type guard: returns `true` when `provider` is one of the trusted providers.
 * Encapsulates the `readonly` → `string[]` cast so call sites don't need
 * ad-hoc type assertions.
 */
export function isTrustedIdentityProvider(provider: string): boolean {
  return (TRUSTED_IDENTITY_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Lucent-owned store for authentication identities.
 *
 * Every login method Lucent supports resolves to a row in `accounts`:
 * email+password logins are a single `credential` identity holding the argon2
 * hash, and each social provider link is its own identity recording the
 * provider-side user id. This service owns those credential rows; social rows
 * are written by `AuthOAuthService`.
 *
 * Password hashing lives here rather than in a third-party auth library so the
 * hash format stays a Lucent implementation detail.
 */
@Injectable()
export class AuthIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Password hashing ─────────────────────────────────────────

  /** Hashes a plain-text password with Lucent's Argon2 parameters. */
  async hashPassword(password: string): Promise<string> {
    return await argon2.hash(password, ARGON2_OPTIONS);
  }

  /** Verifies a plain-text password against a stored Argon2 hash. */
  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password, ARGON2_OPTIONS);
  }

  // ── Credential identities ────────────────────────────────────

  /**
   * Records the local credential identity for `userId`, replacing any existing
   * one. Used by register and by set/change/reset password.
   *
   * `accountId` is the user id: a Lucent user has at most one local password.
   */
  upsertCredentialAccount(
    userId: string,
    passwordHash: string,
    tx?: Prisma.TransactionClient,
  ): ResultAsync<void, DomainFailure> {
    const client = tx ?? this.prisma;
    return fromPromise(
      client.account.upsert({
        where: {
          providerId_accountId: {
            providerId: CREDENTIAL_PROVIDER_ID,
            accountId: userId,
          },
        },
        update: { password: passwordHash },
        create: {
          userId,
          issuer: LOCAL_CREDENTIAL_ISSUER,
          providerId: CREDENTIAL_PROVIDER_ID,
          accountId: userId,
          password: passwordHash,
        },
      }),
      (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Failed to store credential account',
        ),
    ).map(() => undefined);
  }

  /**
   * Returns `true` when the user has a local credential identity with a stored
   * password. Single source of truth for "does this user have a password?".
   */
  hasPassword(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): ResultAsync<boolean, DomainFailure> {
    const client = tx ?? this.prisma;
    return fromPromise(
      client.account.findFirst({
        where: { userId, providerId: CREDENTIAL_PROVIDER_ID },
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

  /**
   * Finds the local credential identity for `userId` and verifies the supplied
   * password. Returns a domain failure with `AUTH_PASSWORD_NOT_SET` when the
   * user has no credential identity, so callers can prompt OAuth-only users to
   * set a password first.
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
   * Creates the Lucent user row for a new local (email+password) registration
   * and its credential identity in one transaction.
   *
   * Returns the existing user unchanged when the email is already registered —
   * callers rely on this to keep registration responses indistinguishable
   * (anti-enumeration).
   */
  createLocalUser(input: {
    email: string;
    passwordHash: string;
    nickname?: string;
  }): ResultAsync<
    { user: LocalIdentityUser; created: boolean },
    DomainFailure
  > {
    return fromPrismaResult(
      this.prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        });
        if (existing) {
          return { user: existing, created: false };
        }

        const user = await tx.user.create({
          data: {
            email: input.email,
            ...(input.nickname !== undefined && { nickname: input.nickname }),
            profile: { create: {} },
          },
          select: { id: true },
        });

        await tx.account.create({
          data: {
            id: randomUUID(),
            userId: user.id,
            issuer: LOCAL_CREDENTIAL_ISSUER,
            providerId: CREDENTIAL_PROVIDER_ID,
            accountId: user.id,
            password: input.passwordHash,
          },
        });

        return { user, created: true };
      }),
    );
  }

  /**
   * Loads the local credential identity by email and verifies `password`.
   *
   * Returns `null` when the email is unknown, has no credential identity, or
   * the password does not match — callers must not distinguish these cases in
   * responses (anti-enumeration).
   */
  authenticateByEmail(
    email: string,
    password: string,
  ): ResultAsync<{ id: string } | null, DomainFailure> {
    return fromPromise(
      this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          accounts: {
            where: { providerId: CREDENTIAL_PROVIDER_ID },
            select: { password: true },
            take: 1,
          },
        },
      }),
      (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Failed to load credential account by email',
        ),
    ).andThen((record) => {
      const hash = record?.accounts[0]?.password;
      if (!record || !hash) {
        return okAsync<{ id: string } | null, DomainFailure>(null);
      }
      return fromPromise(this.verifyPassword(hash, password), (error) =>
        mapUnknownToInternalFailure(error, 'Password verification failed'),
      ).map((matches) => (matches ? { id: record.id } : null));
    });
  }

  private findCredentialAccount(
    userId: string,
  ): ResultAsync<{ password: string | null } | null, DomainFailure> {
    return fromPromise(
      this.prisma.account.findFirst({
        where: { userId, providerId: CREDENTIAL_PROVIDER_ID },
        select: { password: true },
      }),
      (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Failed to load credential account',
        ),
    );
  }
}

/** Minimal user shape returned by credential identity operations. */
export interface LocalIdentityUser {
  id: string;
}
