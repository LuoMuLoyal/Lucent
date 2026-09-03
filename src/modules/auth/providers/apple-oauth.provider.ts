import { createPublicKey } from 'node:crypto';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import {
  toInputJsonValue,
  withRetry,
  extractErrorInfo,
  HttpStatusError,
} from '../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import { ConfigKey } from '../../../config/env/config-keys.enum.js';
import type { OAuthConfig } from '../../../config/services/oauth.config.js';
import {
  OAUTH_PROVIDER_APPLE,
  type OAuthProfile,
} from '../types/oauth.types.js';
import type { OAuthProvider } from './oauth-provider.interface.js';
import {
  classifyFetchError,
  dependencyBadGateway,
} from './dependency-failure.utils.js';
import { now } from '../../../common/index.js';

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
    private readonly jwtService: JwtService,
  ) {}

  fetchProfile(
    credential: Record<string, unknown>,
  ): ResultAsync<OAuthProfile, DomainFailure> {
    const identityToken = credential['identityToken'] as string | undefined;
    if (!identityToken) {
      return errAsync(this.validationFailure());
    }

    return this.verifyIdentityToken(identityToken).map((payload) => {
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
        rawProfile: toInputJsonValue({
          sub: appleUserId,
          email: payload.email ?? null,
          ...(payload.is_private_email !== undefined && {
            isPrivateEmail: payload.is_private_email,
          }),
        }),
      };
    });
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

  private verifyIdentityToken(
    identityToken: string,
  ): ResultAsync<AppleIdTokenPayload, DomainFailure> {
    // Decode without verification to extract kid from header
    const decoded = this.jwtService.decode<DecodedAppleToken | null>(
      identityToken,
      { complete: true },
    );
    if (!decoded) {
      return errAsync(this.validationFailure());
    }

    const { kid } = decoded.header;
    if (!kid) {
      return errAsync(this.validationFailure());
    }

    // Fetch Apple's public key matching the kid
    return this.getAppleJwk(kid)
      .andThen((jwk) => this.jwkToPemResult(jwk))
      .andThen((publicKey) => {
        const config = this.readAppleConfig();

        // jwtService.verifyAsync handles signature, expiry, issuer & audience in one call
        return fromPromise(
          this.jwtService.verifyAsync<AppleIdTokenPayload>(identityToken, {
            secret: publicKey,
            algorithms: ['RS256'],
            issuer: config.issuer,
            audience: config.appId,
            clockTolerance: 30, // 30s leeway for clock skew
          }),
          (error) => {
            this.logger.warn('Apple identity token verification failed', error);
            // A verification failure means the client-supplied token is
            // invalid (bad signature, expired, wrong issuer/audience) — a
            // client input problem, not an upstream dependency failure.
            return this.validationFailure();
          },
        );
      });
  }

  // ── JWKS helpers ────────────────────────────────────────────

  private getAppleJwk(kid: string): ResultAsync<AppleJwk, DomainFailure> {
    return this.fetchAppleJwks().andThen((keys) => {
      const jwk = keys.find((k) => k.kid === kid);
      if (!jwk) {
        // Upstream returned keys that do not cover this token's kid.
        return errAsync(dependencyBadGateway());
      }
      return okAsync(jwk);
    });
  }

  private fetchAppleJwks(): ResultAsync<AppleJwk[], DomainFailure> {
    const nowMs = Date.now();
    if (
      this.appleKeys.length > 0 &&
      nowMs - this.lastJwksFetch < this.JWKS_TTL_MS
    ) {
      return okAsync(this.appleKeys);
    }

    return fromPromise(
      withRetry(async () => {
        const response = await fetch(this.readAppleConfig().jwksUrl);
        if (!response.ok) {
          throw new HttpStatusError(response.status);
        }
        return response;
      }),
      (error) => {
        const { message: reason, stack } = extractErrorInfo(error);
        this.logger.error(`Failed to fetch Apple JWKS: ${reason}`, stack);
        return classifyFetchError(error);
      },
    )
      .andThen((response) =>
        fromPromise(response.json() as Promise<AppleJwksResponse>, (error) => {
          this.logger.error(
            `Failed to decode Apple JWKS response: ${extractErrorInfo(error).message}`,
            extractErrorInfo(error).stack,
          );
          return dependencyBadGateway(error);
        }),
      )
      .map((data) => {
        this.appleKeys = data.keys;
        this.lastJwksFetch = nowMs;
        return this.appleKeys;
      });
  }

  // ── JWK → PEM ──────────────────────────────────────────────

  private jwkToPemResult(jwk: AppleJwk): ResultAsync<string, DomainFailure> {
    return fromPromise(
      Promise.resolve().then(() => this.jwkToPem(jwk)),
      (error) => {
        this.logger.error(
          `Failed to convert Apple JWK to PEM: ${extractErrorInfo(error).message}`,
          extractErrorInfo(error).stack,
        );
        return dependencyBadGateway(error);
      },
    );
  }

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

  private validationFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }
}
