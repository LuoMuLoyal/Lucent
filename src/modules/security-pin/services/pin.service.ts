import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { I18nService } from 'nestjs-i18n';
import * as argon2 from 'argon2';

import { PrismaService } from '../../../prisma';
import { ConfigKey } from '../../../config/env/config-keys.enum';
import { ARGON2_OPTIONS } from '../../auth';
import { badRequest, forbidden, notFound, unauthorized } from '../../../common';
import { now } from '../../../common';
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
 */
@Injectable()
export class SecurityPinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  private get jwtConfig(): JwtConfigShape {
    return this.configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);
  }

  async enable(userId: string, dto: { pin: string }): Promise<void> {
    this.assertPinFormat(dto.pin);
    const hash = await argon2.hash(dto.pin, ARGON2_OPTIONS);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        securityPinEnabled: true,
        securityPinHash: hash,
        securityPinChangedAt: now(),
        securityElevationVersion: { increment: 1 },
      },
    });
  }

  async change(
    userId: string,
    dto: { oldPin: string; newPin: string },
  ): Promise<void> {
    this.assertPinFormat(dto.newPin);
    const user = await this.loadSecurityPinUser(userId);
    if (!user.securityPinEnabled || !user.securityPinHash) {
      forbidden(this.i18n.t('security_pin.not_enabled'));
    }

    const valid = await argon2.verify(user.securityPinHash, dto.oldPin);
    if (!valid) {
      unauthorized(this.i18n.t('security_pin.invalid_pin'));
    }

    const hash = await argon2.hash(dto.newPin, ARGON2_OPTIONS);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        securityPinEnabled: true,
        securityPinHash: hash,
        securityPinChangedAt: now(),
        securityElevationVersion: { increment: 1 },
      },
    });
  }

  async disable(userId: string, dto: { pin: string }): Promise<void> {
    this.assertPinFormat(dto.pin);
    const user = await this.loadSecurityPinUser(userId);
    if (!user.securityPinEnabled || !user.securityPinHash) {
      forbidden(this.i18n.t('security_pin.not_enabled'));
    }

    const valid = await argon2.verify(user.securityPinHash, dto.pin);
    if (!valid) {
      unauthorized(this.i18n.t('security_pin.invalid_pin'));
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        securityPinEnabled: false,
        securityPinHash: null,
        securityPinChangedAt: null,
        securityElevationVersion: { increment: 1 },
      },
    });
  }

  async verify(
    userId: string,
    dto: { pin: string },
  ): Promise<SecurityElevationResult> {
    this.assertPinFormat(dto.pin);
    const user = await this.loadSecurityPinUser(userId);
    if (!user.securityPinEnabled || !user.securityPinHash) {
      forbidden(this.i18n.t('security_pin.not_enabled'));
    }

    const valid = await argon2.verify(user.securityPinHash, dto.pin);
    if (!valid) {
      unauthorized(this.i18n.t('security_pin.invalid_pin'));
    }

    return this.createElevation(user);
  }

  async getStatus(userId: string): Promise<SecurityPinStatusDto> {
    const user = await this.loadSecurityPinUser(userId);
    return {
      enabled: user.securityPinEnabled,
      lastChangedAt: user.securityPinChangedAt?.toISOString() ?? null,
    };
  }

  async verifyElevationToken(
    token: string,
    userId: string,
  ): Promise<SecurityElevationPayload> {
    const payload = await this.jwtService.verifyAsync<SecurityElevationPayload>(
      token,
      {
        secret: this.jwtConfig.accessSecret,
        algorithms: ['HS512'],
        issuer: this.jwtConfig.issuer,
        audience: this.jwtConfig.audience,
      },
    );

    if (payload.sub !== userId || payload.scope !== SECURITY_ELEVATION_SCOPE) {
      unauthorized(this.i18n.t('security_pin.elevation_token_invalid'));
    }

    const user = await this.loadSecurityPinUser(userId);
    if (!user.securityPinEnabled) {
      forbidden(this.i18n.t('security_pin.not_enabled'));
    }
    if (payload.version !== user.securityElevationVersion) {
      unauthorized(this.i18n.t('security_pin.elevation_token_stale'));
    }

    return payload;
  }

  private assertPinFormat(pin: string): void {
    if (!SECURITY_PIN_REGEX.test(pin)) {
      badRequest(this.i18n.t('security_pin.invalid_format'));
    }
  }

  private async loadSecurityPinUser(userId: string): Promise<SecurityPinUser> {
    const user = await this.prisma.nonDeleted.user.findFirst({
      where: { id: userId },
      select: {
        id: true,
        securityPinEnabled: true,
        securityPinHash: true,
        securityElevationVersion: true,
        securityPinChangedAt: true,
      },
    });
    if (!user) {
      notFound(this.i18n.t('auth.user_not_found'));
    }
    return user;
  }

  private async createElevation(
    user: SecurityPinUser,
  ): Promise<SecurityElevationResult> {
    const expiresAt = new Date(
      Date.now() + SECURITY_ELEVATION_TTL_SECONDS * 1000,
    );
    const elevationToken = await this.jwtService.signAsync(
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
    );

    return { elevationToken, expiresAt: expiresAt.toISOString() };
  }
}
