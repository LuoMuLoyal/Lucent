import { createPublicKey } from 'node:crypto';

import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { I18nService } from 'nestjs-i18n';

import { ResultCode } from '../../../common/api-envelope';
import { unauthorized } from '../../../common/helpers/api-errors';
import { withRetry } from '../../../common/helpers/retry.utils';
import { ConfigKey } from '../../../config/config-keys.enum';
import type { OAuthConfig } from '../../../config/oauth.config';
import type { Prisma } from '#generated/prisma/client';
import { OAUTH_PROVIDER_APPLE, type OAuthProfile } from '../types/oauth.types';
import type { OAuthProvider } from './oauth-provider.interface';
import { now } from '../../../common/helpers/date-time.utils';

interface AppleJwk {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}

interface AppleJwksResponse {
  keys: AppleJwk[];
}

interface AppleIdTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean;
  real_user_status?: number;
}

interface DecodedAppleToken {
  header: { kid?: string; alg?: string };
  payload: unknown;
  signature: string;
}

@Injectable()
export class AppleOAuthProvider implements OAuthProvider, OnModuleInit {
  readonly provider = OAUTH_PROVIDER_APPLE;

  private readonly logger = new Logger(AppleOAuthProvider.name);
  private appleKeys: AppleJwk[] = [];
  private lastJwksFetch = 0;
  private readonly JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
    private readonly jwtService: JwtService,
  ) {}

  async fetchProfile(
    credential: Record<string, unknown>,
  ): Promise<OAuthProfile> {
    const identityToken = credential['identityToken'] as string | undefined;
    if (!identityToken) {
      unauthorized(this.i18n.t('auth.oauth_code_required'));
    }

    const payload = await this.verifyIdentityToken(identityToken);
    const appleUserId = payload.sub;
    const givenName = credential['givenName'] as string | undefined;
    const familyName = credential['familyName'] as string | undefined;

    return {
      provider: OAUTH_PROVIDER_APPLE,
      providerUserId: appleUserId,
      email: payload.email ?? null,
      emailVerifiedAt:
        payload.email_verified === true || payload.email_verified === 'true'
          ? now()
          : null,
      nickname:
        (givenName ?? familyName)
          ? [givenName, familyName].filter(Boolean).join(' ') || null
          : null,
      rawProfile: {
        sub: appleUserId,
        email: payload.email ?? null,
        ...(payload.is_private_email !== undefined && {
          isPrivateEmail: payload.is_private_email,
        }),
      } as Prisma.InputJsonValue,
    };
  }

  onModuleInit(): void {
    const config = this.readAppleConfig();
    if (!config.appId) {
      this.logger.warn(
        'Apple OAuth is not fully configured — Apple Sign In will be unavailable.',
      );
    }
  }

  // ── IdentityToken verification ──────────────────────────────

  private async verifyIdentityToken(
    identityToken: string,
  ): Promise<AppleIdTokenPayload> {
    // Decode without verification to extract kid from header
    const decoded = this.jwtService.decode<DecodedAppleToken | null>(
      identityToken,
      { complete: true },
    );
    if (!decoded) {
      unauthorized(this.i18n.t('auth.oauth_code_invalid'));
    }

    const { kid } = decoded.header;
    if (!kid) {
      unauthorized(this.i18n.t('auth.oauth_code_invalid'));
    }

    // Fetch Apple's public key matching the kid
    const jwk = await this.getAppleJwk(kid);
    const publicKey = this.jwkToPem(jwk);

    const config = this.readAppleConfig();

    // jwtService.verifyAsync handles signature, expiry, issuer & audience in one call
    try {
      const payload = await this.jwtService.verifyAsync<AppleIdTokenPayload>(
        identityToken,
        {
          secret: publicKey,
          algorithms: ['RS256'],
          issuer: config.issuer,
          audience: config.appId,
          clockTolerance: 30, // 30s leeway for clock skew
        },
      );

      return payload;
    } catch (err) {
      this.logger.warn('Apple identity token verification failed', err);
      unauthorized(this.i18n.t('auth.oauth_code_invalid'));
    }
  }

  // ── JWKS helpers ────────────────────────────────────────────

  private async getAppleJwk(kid: string): Promise<AppleJwk> {
    const keys = await this.fetchAppleJwks();
    const jwk = keys.find((k) => k.kid === kid);
    if (!jwk) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }
    return jwk;
  }

  private async fetchAppleJwks(): Promise<AppleJwk[]> {
    const now = Date.now();
    if (
      this.appleKeys.length > 0 &&
      now - this.lastJwksFetch < this.JWKS_TTL_MS
    ) {
      return this.appleKeys;
    }

    const config = this.readAppleConfig();

    try {
      const response = await withRetry(async () => {
        const res = await fetch(config.jwksUrl);
        if (!res.ok) {
          throw new Error(`JWKS fetch failed: ${String(res.status)}`);
        }
        return res;
      });
      const data = (await response.json()) as AppleJwksResponse;
      this.appleKeys = data.keys;
      this.lastJwksFetch = now;
      return this.appleKeys;
    } catch (err) {
      this.logger.error('Failed to fetch Apple JWKS', err);
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }
  }

  // ── JWK → PEM ──────────────────────────────────────────────

  private jwkToPem(jwk: AppleJwk): string {
    const key = createPublicKey({
      key: {
        kty: jwk.kty,
        n: jwk.n,
        e: jwk.e,
      },
      format: 'jwk',
    });
    return key.export({ type: 'spki', format: 'pem' }) as string;
  }

  // ── Config ──────────────────────────────────────────────────

  private readAppleConfig(): {
    appId: string;
    jwksUrl: string;
    issuer: string;
  } {
    const config = this.configService.getOrThrow<OAuthConfig>(ConfigKey.OAuth);
    return config.apple;
  }
}
