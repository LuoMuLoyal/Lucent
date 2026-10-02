import { createPublicKey } from 'node:crypto';

import {
  extractErrorInfo,
  fetchWithRetry,
  toInputJsonValue,
} from '../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ConfigKey } from '../../../config/env/config-keys.enum.js';
import type { OAuthConfig } from '../../../config/services/oauth.config.js';
import {
  OAUTH_PROVIDER_GOOGLE,
  type OAuthProfile,
} from '../types/oauth.types.js';
import type { OAuthProvider } from './oauth-provider.interface.js';
import {
  classifyFetchError,
  dependencyBadGateway,
} from './dependency-failure.utils.js';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUER = 'https://accounts.google.com';
/** Google also issues tokens with the scheme-less issuer. */
const GOOGLE_ISSUER_ALT = 'accounts.google.com';
const GOOGLE_SCOPE = 'openid email profile';
const GOOGLE_JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

interface GoogleJwk {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}

interface GoogleJwksResponse {
  keys: GoogleJwk[];
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
  id_token?: string;
}

interface GoogleUserInfoResponse {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
}

@Injectable()
export class GoogleOAuthProvider implements OAuthProvider, OnModuleInit {
  readonly provider = OAUTH_PROVIDER_GOOGLE;

  private readonly logger = new Logger(GoogleOAuthProvider.name);
  private googleKeys: GoogleJwk[] = [];
  private lastJwksFetch = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  buildAuthorizeUrl(state: string, callbackUri?: string): string {
    const config = this.getConfig();
    const redirectUri = callbackUri ?? config.redirectUri;

    if (!redirectUri) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Google OAuth is not configured.',
      });
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.appId,
      redirect_uri: redirectUri,
      scope: GOOGLE_SCOPE,
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
  }

  exchangeCodeForTokens(
    code: string,
  ): ResultAsync<{ accessToken: string; idToken: string }, DomainFailure> {
    const config = this.getConfig();

    return this.fetchAccessToken(code, config).andThen((token) => {
      if (!token.id_token) {
        return errAsync(dependencyBadGateway());
      }
      return okAsync({
        accessToken: token.access_token,
        idToken: token.id_token,
      });
    });
  }

  fetchProfile(
    credential: Record<string, unknown>,
  ): ResultAsync<OAuthProfile, DomainFailure> {
    const code = credential['code'] as string;
    if (!code) {
      return errAsync(this.validationFailure());
    }

    const config = this.getConfig();

    // Step 1: exchange code for access_token (POST form-urlencoded)
    return this.fetchAccessToken(code, config).andThen((token) =>
      // Step 2: get user info (GET with Bearer token)
      this.fetchUserInfo(token.access_token).map(
        (userInfo): OAuthProfile => ({
          provider: OAUTH_PROVIDER_GOOGLE,
          providerUserId: userInfo.sub,
          email: userInfo.email ?? null,
          emailVerifiedAt: userInfo.email_verified === true ? new Date() : null,
          nickname: userInfo.name ?? null,
          avatar: userInfo.picture ?? null,
          rawProfile: toInputJsonValue({
            sub: userInfo.sub,
            email: userInfo.email ?? null,
            name: userInfo.name ?? null,
            given_name: userInfo.given_name ?? null,
            family_name: userInfo.family_name ?? null,
            picture: userInfo.picture ?? null,
            locale: userInfo.locale ?? null,
          }),
        }),
      ),
    );
  }

  /**
   * Builds a profile from an ID token obtained by {@link exchangeCodeForTokens}.
   *
   * The ID token is verified against Google's JWKS and its claims checked
   * (issuer, audience, expiry) before the profile is trusted; the authoritative
   * profile fields then come from the userinfo endpoint, which is bound to the
   * access token Google just issued.
   */
  fetchProfileFromIdToken(
    idToken: string,
    accessToken: string,
  ): ResultAsync<OAuthProfile, DomainFailure> {
    return this.verifyIdToken(idToken).andThen(() =>
      this.fetchUserInfo(accessToken).map(
        (userInfo): OAuthProfile => ({
          provider: OAUTH_PROVIDER_GOOGLE,
          providerUserId: userInfo.sub,
          email: userInfo.email ?? null,
          emailVerifiedAt: userInfo.email_verified === true ? new Date() : null,
          nickname: userInfo.name ?? null,
          avatar: userInfo.picture ?? null,
          rawProfile: toInputJsonValue({
            sub: userInfo.sub,
            email: userInfo.email ?? null,
            name: userInfo.name ?? null,
            given_name: userInfo.given_name ?? null,
            family_name: userInfo.family_name ?? null,
            picture: userInfo.picture ?? null,
            locale: userInfo.locale ?? null,
          }),
        }),
      ),
    );
  }

  /**
   * Verifies a Google ID token: signature against Google's published JWKS,
   * plus `iss`/`aud`/`exp` claims. A token that fails any check is treated as
   * an upstream failure rather than a client validation error, because Lucent
   * only ever sees tokens it requested itself.
   */
  private verifyIdToken(idToken: string): ResultAsync<void, DomainFailure> {
    const config = this.readRawConfig();
    if (!config.appId) {
      return errAsync(dependencyBadGateway());
    }

    return this.getGoogleJwk(idToken)
      .andThen((jwk) => this.jwkToPemResult(jwk))
      .andThen((publicKey) =>
        fromPromise(
          this.jwtService.verifyAsync(idToken, {
            secret: publicKey,
            algorithms: ['RS256'],
            issuer: [GOOGLE_ISSUER, GOOGLE_ISSUER_ALT],
            audience: config.appId,
            clockTolerance: 30, // 30s leeway for clock skew
          }),
          (error) => {
            const { message: reason, stack } = extractErrorInfo(error);
            this.logger.error(
              `Google ID token verification failed: ${reason}`,
              stack,
            );
            return dependencyBadGateway(error);
          },
        ),
      )
      .map(() => undefined);
  }

  /** Resolves the JWKS entry matching the token's `kid`. */
  private getGoogleJwk(idToken: string): ResultAsync<GoogleJwk, DomainFailure> {
    // Decode without verification purely to read the `kid`; the signature and
    // claims are checked by `verifyAsync` once the key is in hand.
    const decoded = this.jwtService.decode<{ header?: { kid?: string } }>(
      idToken,
      { complete: true },
    ) as { header?: { kid?: string } } | null;
    const kid = decoded?.header?.kid;
    if (!kid) {
      return errAsync(dependencyBadGateway());
    }

    return this.fetchGoogleJwks().andThen((keys) => {
      const jwk = keys.find((key) => key.kid === kid);
      if (!jwk) {
        // Upstream returned keys that do not cover this token's kid.
        return errAsync(dependencyBadGateway());
      }
      return okAsync(jwk);
    });
  }

  private fetchGoogleJwks(): ResultAsync<GoogleJwk[], DomainFailure> {
    const nowMs = Date.now();
    if (
      this.googleKeys.length > 0 &&
      nowMs - this.lastJwksFetch < GOOGLE_JWKS_TTL_MS
    ) {
      return okAsync(this.googleKeys);
    }

    return this.fetchGoogleApi(GOOGLE_JWKS_URL)
      .andThen((response) => this.parseJson<GoogleJwksResponse>(response))
      .map((data) => {
        this.googleKeys = data.keys;
        this.lastJwksFetch = nowMs;
        return this.googleKeys;
      });
  }

  private jwkToPemResult(jwk: GoogleJwk): ResultAsync<string, DomainFailure> {
    return fromPromise(
      Promise.resolve().then(() => this.jwkToPem(jwk)),
      (error) => {
        const { message: reason, stack } = extractErrorInfo(error);
        this.logger.error(
          `Failed to convert Google JWK to PEM: ${reason}`,
          stack,
        );
        return dependencyBadGateway(error);
      },
    );
  }

  private jwkToPem(jwk: GoogleJwk): string {
    const key = createPublicKey({
      key: { kty: jwk.kty, n: jwk.n, e: jwk.e },
      format: 'jwk',
    });
    return key.export({ type: 'spki', format: 'pem' });
  }

  onModuleInit(): void {
    const config = this.readRawConfig();
    if (!config.appId || !config.appSecret) {
      this.logger.warn(
        'Google OAuth is not fully configured — Google login will be unavailable.',
      );
    }
  }

  // ── Google API helpers ──────────────────────────────────────

  private fetchAccessToken(
    code: string,
    config: { appId: string; appSecret: string; redirectUri: string },
  ): ResultAsync<GoogleTokenResponse, DomainFailure> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.appId,
      client_secret: config.appSecret,
      code,
      redirect_uri: config.redirectUri,
    });

    return this.fetchGoogleApi(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
      .andThen((response) => this.parseJson<Record<string, unknown>>(response))
      .andThen((data) => {
        // Upstream rejected the code (invalid_grant, expired, already used...).
        if ((data as { error?: string }).error) {
          return errAsync(dependencyBadGateway());
        }
        const tokenResponse = data as unknown as GoogleTokenResponse;
        if (!tokenResponse.access_token) {
          return errAsync(dependencyBadGateway());
        }
        return okAsync(tokenResponse);
      });
  }

  private fetchUserInfo(
    accessToken: string,
  ): ResultAsync<GoogleUserInfoResponse, DomainFailure> {
    return this.fetchGoogleApi(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .andThen((response) => this.parseJson<Record<string, unknown>>(response))
      .andThen((data) => {
        if ((data as { error?: string }).error) {
          return errAsync(dependencyBadGateway());
        }
        const userInfo = data as unknown as GoogleUserInfoResponse;
        // Profile is unusable without a stable provider user id.
        if (!userInfo.sub) {
          return errAsync(dependencyBadGateway());
        }
        return okAsync(userInfo);
      });
  }

  // ── HTTP helpers ────────────────────────────────────────────

  private fetchGoogleApi(
    url: string,
    init?: RequestInit,
  ): ResultAsync<Response, DomainFailure> {
    return fromPromise(fetchWithRetry(url, init), (error) => {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(`Google API request failed: ${reason}`, stack);
      return classifyFetchError(error);
    });
  }

  private parseJson<T>(response: Response): ResultAsync<T, DomainFailure> {
    return fromPromise(response.json() as Promise<T>, (error) => {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(
        `Failed to decode Google API JSON response: ${reason}`,
        stack,
      );
      return dependencyBadGateway(error);
    });
  }

  // ── Config ──────────────────────────────────────────────────

  private getConfig(): {
    appId: string;
    appSecret: string;
    redirectUri: string;
  } {
    const config = this.readRawConfig();

    if (!config.appId || !config.appSecret || !config.redirectUri) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Google OAuth is not configured.',
      });
    }

    return config;
  }

  private readRawConfig(): {
    appId: string;
    appSecret: string;
    redirectUri: string;
  } {
    const config = this.configService.getOrThrow<OAuthConfig>(ConfigKey.OAuth);
    return config.google;
  }

  private validationFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }
}
