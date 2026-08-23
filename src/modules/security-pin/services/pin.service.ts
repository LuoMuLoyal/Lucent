import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { PrismaService } from '../../../prisma';
import { ConfigKey } from '../../../config/env/config-keys.enum';
import { ARGON2_OPTIONS } from '../../auth';
import { fromPrismaResult, now } from '../../../common';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';
import {
  SECURITY_ELEVATION_SCOPE,
  SECURITY_ELEVATION_TTL_SECONDS,
  type SecurityElevationPayload,
  type SecurityElevationResult,
} from '../types/elevation.types';

interface JwtConfigShape {
  accessSecret: string;
  issuer: string;
  audience: string;
}

interface SecurityPinUser {
  id: string;
  securityPinEnabled: boolean;
  securityPinHash: string | null;
  securityPinChangedAt: Date | null;
  securityElevationVersion: number;
}

const SECURITY_PIN_REGEX = /^\d{6}$/;

export interface SecurityPinStatusDto {
  enabled: boolean;
  lastChangedAt: string | null;
}

/**
 * Domain service for the in-app Security PIN credential.
 *
 * - PINs are 6-digit numeric strings hashed with argon2id.
 * - Enabling, changing, or disabling a PIN bumps the user's elevation version,
 *   which invalidates previously issued elevation tokens.
 * - A successful verify() mints a short-lived signed elevation token that guards
 *   sensitive endpoints.
 *
 * All expected business failures are expressed as
 * `ResultAsync<T, DomainFailure>`:
 * - missing user -> `RESOURCE_NOT_FOUND`
 * - PIN not set / wrong PIN / stale elevation version -> `AUTH_ELEVATION_REQUIRED`
 * - expired or signature-invalid elevation token -> `AUTH_ELEVATION_TOKEN_INVALID`
 *
 * Unknown Argon2, signing and database failures are re-thrown so they keep
 * their real dependency/internal semantics instead of being misreported as a
 * PIN business failure.
 */
@Injectable()
export class SecurityPinService {
  private readonly logger = new Logger(SecurityPinService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private get jwtConfig(): JwtConfigShape {
    return this.configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);
  }

  enable(
    userId: string,
    dto: { pin: string },
  ): ResultAsync<void, DomainFailure> {
    const formatFailure = this.pinFormatFailure(dto.pin);
    if (formatFailure) return errAsync(formatFailure);

    return this.hashPin(dto.pin, 'enable')
      .andThen((hash) =>
        fromPrismaResult(
          this.prisma.user.update({
            where: { id: userId },
            data: {
              securityPinEnabled: true,
              securityPinHash: hash,
              securityPinChangedAt: now(),
              securityElevationVersion: { increment: 1 },
            },
          }),
        ),
      )
      .map(() => undefined);
  }

  change(
    userId: string,
    dto: { oldPin: string; newPin: string },
  ): ResultAsync<void, DomainFailure> {
    const formatFailure = this.pinFormatFailure(dto.newPin);
    if (formatFailure) return errAsync(formatFailure);

    return this.loadSecurityPinUser(userId).andThen((user) => {
      if (!user.securityPinEnabled || !user.securityPinHash) {
        return errAsync(this.pinNotEnabledFailure());
      }
      return this.verifyPin(user.securityPinHash, dto.oldPin, 'change')
        .andThen((valid) => {
          if (!valid) return errAsync(this.pinInvalidFailure());
          return this.hashPin(dto.newPin, 'change');
        })
        .andThen((hash) =>
          fromPrismaResult(
            this.prisma.user.update({
              where: { id: userId },
              data: {
                securityPinEnabled: true,
                securityPinHash: hash,
                securityPinChangedAt: now(),
                securityElevationVersion: { increment: 1 },
              },
            }),
          ),
        )
        .map(() => undefined);
    });
  }

  disable(
    userId: string,
    dto: { pin: string },
  ): ResultAsync<void, DomainFailure> {
    const formatFailure = this.pinFormatFailure(dto.pin);
    if (formatFailure) return errAsync(formatFailure);

    return this.loadSecurityPinUser(userId).andThen((user) => {
      if (!user.securityPinEnabled || !user.securityPinHash) {
        return errAsync(this.pinNotEnabledFailure());
      }
      return this.verifyPin(user.securityPinHash, dto.pin, 'disable')
        .andThen((valid) => {
          if (!valid) return errAsync(this.pinInvalidFailure());
          return fromPrismaResult(
            this.prisma.user.update({
              where: { id: userId },
              data: {
                securityPinEnabled: false,
                securityPinHash: null,
                securityPinChangedAt: null,
                securityElevationVersion: { increment: 1 },
              },
            }),
          );
        })
        .map(() => undefined);
    });
  }

  verify(
    userId: string,
    dto: { pin: string },
  ): ResultAsync<SecurityElevationResult, DomainFailure> {
    const formatFailure = this.pinFormatFailure(dto.pin);
    if (formatFailure) return errAsync(formatFailure);

    return this.loadSecurityPinUser(userId).andThen((user) => {
      if (!user.securityPinEnabled || !user.securityPinHash) {
        return errAsync(this.pinNotEnabledFailure());
      }
      return this.verifyPin(user.securityPinHash, dto.pin, 'verify').andThen(
        (valid) =>
          valid
            ? this.createElevation(user)
            : errAsync(this.pinInvalidFailure()),
      );
    });
  }

  getStatus(userId: string): ResultAsync<SecurityPinStatusDto, DomainFailure> {
    return this.loadSecurityPinUser(userId).map((user) => ({
      enabled: user.securityPinEnabled,
      lastChangedAt: user.securityPinChangedAt?.toISOString() ?? null,
    }));
  }

  verifyElevationToken(
    token: string,
    userId: string,
  ): ResultAsync<SecurityElevationPayload, DomainFailure> {
    return fromPromise(
      this.jwtService.verifyAsync<SecurityElevationPayload>(token, {
        secret: this.jwtConfig.accessSecret,
        algorithms: ['HS512'],
        issuer: this.jwtConfig.issuer,
        audience: this.jwtConfig.audience,
      }),
      () => this.elevationTokenInvalidFailure(),
    ).andThen((payload) => {
      if (
        payload.sub !== userId ||
        payload.scope !== SECURITY_ELEVATION_SCOPE
      ) {
        return errAsync(this.elevationTokenInvalidFailure());
      }

      return this.loadSecurityPinUser(userId).andThen((user) => {
        if (!user.securityPinEnabled) {
          return errAsync(this.pinNotEnabledFailure());
        }
        if (payload.version !== user.securityElevationVersion) {
          // The PIN changed since the token was issued; re-elevation is
          // required rather than treating the token as invalid.
          return errAsync(this.elevationRequiredFailure());
        }
        return okAsync(payload);
      });
    });
  }

  private pinFormatFailure(pin: string): DomainFailure | null {
    if (SECURITY_PIN_REGEX.test(pin)) return null;
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }

  private pinNotEnabledFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'authentication',
      code: 'AUTH_ELEVATION_REQUIRED',
    });
  }

  private pinInvalidFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'authentication',
      code: 'AUTH_ELEVATION_REQUIRED',
    });
  }

  private elevationRequiredFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'authentication',
      code: 'AUTH_ELEVATION_REQUIRED',
    });
  }

  private elevationTokenInvalidFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'authentication',
      code: 'AUTH_ELEVATION_TOKEN_INVALID',
    });
  }

  /**
   * Lifts a `findFirst` into `ResultAsync`. A missing user is a business
   * failure (`RESOURCE_NOT_FOUND`); unknown database errors are re-thrown so
   * they keep their real dependency/internal semantics.
   */
  private loadSecurityPinUser(
    userId: string,
  ): ResultAsync<SecurityPinUser, DomainFailure> {
    return fromPromise(
      this.prisma.nonDeleted.user.findFirst({
        where: { id: userId },
        select: {
          id: true,
          securityPinEnabled: true,
          securityPinHash: true,
          securityElevationVersion: true,
          securityPinChangedAt: true,
        },
      }),
      (error) => {
        throw error;
      },
    ).andThen((user) => {
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
   * Verifies a PIN against the stored Argon2 hash. A mismatch
   * (`argon2.verify` returning `false`) maps to `AUTH_ELEVATION_REQUIRED`.
   * A thrown Argon2 failure (malformed/corrupted stored hash, native binding
   * error, module/config fault) is re-thrown so it surfaces as a
   * dependency/internal error at the boundary instead of being folded into a
   * PIN business failure; the underlying error is logged for observability.
   */
  private verifyPin(
    hash: string,
    pin: string,
    context: string,
  ): ResultAsync<boolean, DomainFailure> {
    return fromPromise(argon2.verify(hash, pin), (error) => {
      this.logger.warn(
        `argon2.verify threw (${context}): ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    });
  }

  private hashPin(
    pin: string,
    context: string,
  ): ResultAsync<string, DomainFailure> {
    return fromPromise(argon2.hash(pin, ARGON2_OPTIONS), (error) => {
      this.logger.warn(
        `argon2.hash threw (${context}): ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    });
  }

  private createElevation(
    user: SecurityPinUser,
  ): ResultAsync<SecurityElevationResult, DomainFailure> {
    const expiresAt = new Date(
      Date.now() + SECURITY_ELEVATION_TTL_SECONDS * 1000,
    );
    return fromPromise(
      this.jwtService.signAsync(
        {
          sub: user.id,
          scope: SECURITY_ELEVATION_SCOPE,
          version: user.securityElevationVersion,
        },
        {
          secret: this.jwtConfig.accessSecret,
          expiresIn: SECURITY_ELEVATION_TTL_SECONDS,
          algorithm: 'HS512',
          issuer: this.jwtConfig.issuer,
          audience: this.jwtConfig.audience,
        },
      ),
      (error) => {
        // Signing failures are never misreported as a PIN business failure.
        throw error;
      },
    ).map((elevationToken) => ({
      elevationToken,
      expiresAt: expiresAt.toISOString(),
    }));
  }
}
