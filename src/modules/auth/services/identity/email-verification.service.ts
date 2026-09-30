import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';

import {
  createDomainFailure,
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { UserService } from '../../../user/index.js';

/**
 * Issues and consumes single-use email-verification tokens.
 *
 * The token is an opaque random string mailed to the address; only its SHA-256
 * digest is stored, in cache, with a TTL — the same shape as
 * {@link VerificationCodeService}, and deliberately not a database table (a
 * token is worthless after its TTL and needs no history).
 *
 * Distinct from `VerificationCodeService`, which handles the short numeric
 * anti-abuse codes for register/login/set-password scenes: this one exists for
 * the link-based `POST /auth/verify-email` flow, where the user taps a link in
 * their inbox instead of typing a code.
 */
@Injectable()
export class EmailVerificationService {
  private static readonly CACHE_KEY_PREFIX = 'email-verify';
  private static readonly TOKEN_BYTES = 32;

  private readonly tokenTtlMs: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly prisma: PrismaService,
  ) {
    this.tokenTtlMs = Number(
      this.configService.get<string>(EnvKey.VERIFICATION_CODE_TTL_MS),
    );
  }

  /**
   * Issues a verification token for `email` and returns it. Callers mail the
   * returned token; it is never stored in plaintext.
   */
  issue(email: string): ResultAsync<string, DomainFailure> {
    const token = randomBytes(EmailVerificationService.TOKEN_BYTES).toString(
      'base64url',
    );

    return fromPromise(
      this.cache.set(this.cacheKey(token), email, this.tokenTtlMs),
      (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Failed to store email verification token',
        ),
    ).map(() => token);
  }

  /**
   * Consumes `token`, marking the matching account's email verified.
   *
   * The token is deleted before the user row is updated, so a replay — even a
   * concurrent one — cannot verify the same address twice. An unknown or
   * expired token yields `AUTH_VERIFICATION_CODE_EXPIRED`.
   */
  consume(token: string): ResultAsync<void, DomainFailure> {
    const key = this.cacheKey(token);

    return fromPromise(this.cache.get<string>(key), (error) =>
      mapUnknownToDependencyFailure(
        error,
        'Failed to read email verification token',
      ),
    ).andThen((email) => {
      if (!email) {
        return errAsync(this.tokenInvalid());
      }

      return fromPromise(this.cache.del(key), (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Failed to consume email verification token',
        ),
      ).andThen(() => this.markVerified(email));
    });
  }

  // ── Helpers ──────────────────────────────────────────────────

  private markVerified(email: string): ResultAsync<void, DomainFailure> {
    return fromPromise(
      this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      }),
      (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Failed to load user for email verification',
        ),
    )
      .andThen((user) => {
        if (!user) {
          return errAsync(this.tokenInvalid());
        }
        return this.userService
          .update(user.id, { emailVerified: true, emailVerifiedAt: new Date() })
          .map(() => undefined);
      })
      .orElse((error) => {
        if (error.kind === 'not_found') {
          return errAsync(this.tokenInvalid());
        }
        return errAsync(error);
      });
  }

  private cacheKey(token: string): string {
    return `${EmailVerificationService.CACHE_KEY_PREFIX}:${digest(token)}`;
  }

  private tokenInvalid(): DomainFailure {
    return createDomainFailure({
      kind: 'authentication',
      code: 'AUTH_VERIFICATION_CODE_EXPIRED',
    });
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
