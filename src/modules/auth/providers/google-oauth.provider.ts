import { unauthorized } from '../../../common';
import { extractErrorInfo } from '../../../common';
import { fetchWithRetry } from '../../../common';
import { toInputJsonValue } from '../../../common';
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import { ConfigKey } from '../../../config/env/config-keys.enum';
import type { OAuthConfig } from '../../../config/services/oauth.config';
import { OAUTH_PROVIDER_GOOGLE, type OAuthProfile } from '../types/oauth.types';
import type { OAuthProvider } from './oauth-provider.interface';

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

  constructor(
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  buildAuthorizeUrl(state: string, callbackUri?: string): string {
    const config = this.getConfig();
    const redirectUri = callbackUri ?? config.redirectUri;

    if (!redirectUri) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: this.i18n.t('auth.oauth_provider_not_configured'),
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

  async fetchProfile(
    credential: Record<string, unknown>,
  ): Promise<OAuthProfile> {
    const code = credential['code'] as string;
    if (!code) {
      unauthorized(this.i18n.t('auth.oauth_code_required'));
    }

    const config = this.getConfig();

    // Step 1: exchange code for access_token (POST form-urlencoded)
    const token = await this.fetchAccessToken(code, config);

    // Step 2: get user info (GET with Bearer token)
    const userInfo = await this.fetchUserInfo(token.access_token);

    return {
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
    };
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

  private async fetchAccessToken(
    code: string,
    config: { appId: string; appSecret: string; redirectUri: string },
  ): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.appId,
      client_secret: config.appSecret,
      code,
      redirect_uri: config.redirectUri,
    });

    const response = await this.fetchGoogleApi(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = (await response.json()) as Record<string, unknown>;

    if ((data as { error?: string }).error) {
      unauthorized(this.i18n.t('auth.oauth_code_invalid'));
    }

    const tokenResponse = data as unknown as GoogleTokenResponse;
    if (!tokenResponse.access_token) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }

    return tokenResponse;
  }

  private async fetchUserInfo(
    accessToken: string,
  ): Promise<GoogleUserInfoResponse> {
    const response = await this.fetchGoogleApi(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = (await response.json()) as Record<string, unknown>;

    if ((data as { error?: string }).error) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }

    return data as unknown as GoogleUserInfoResponse;
  }

  // ── HTTP helpers ────────────────────────────────────────────

  private async fetchGoogleApi(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    try {
      return await fetchWithRetry(url, init);
    } catch (error) {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(`Google API request failed: ${reason}`, stack);
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }
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
        message: this.i18n.t('auth.oauth_provider_not_configured'),
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
}
