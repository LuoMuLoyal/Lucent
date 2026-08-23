import {
  extractErrorInfo,
  fetchWithRetry,
  toInputJsonValue,
} from '../../../common';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../../config/env/config-keys.enum';
import type { OAuthConfig } from '../../../config/services/oauth.config';
import { OAUTH_PROVIDER_GOOGLE, type OAuthProfile } from '../types/oauth.types';
import type { OAuthProvider } from './oauth-provider.interface';
import {
  classifyFetchError,
  dependencyBadGateway,
} from './dependency-failure.utils';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const GOOGLE_SCOPE = 'openid email profile';

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

  constructor(private readonly configService: ConfigService) {}

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
