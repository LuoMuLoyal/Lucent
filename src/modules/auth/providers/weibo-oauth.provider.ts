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
import { ResultCode } from '../../../common';
import { ConfigKey } from '../../../config/env/config-keys.enum';
import type { OAuthConfig } from '../../../config/services/oauth.config';
import { OAUTH_PROVIDER_WEIBO, type OAuthProfile } from '../types/oauth.types';
import type { OAuthProvider } from './oauth-provider.interface';

const WEIBO_AUTHORIZE_URL = 'https://api.weibo.com/oauth2/authorize';
const WEIBO_ACCESS_TOKEN_URL = 'https://api.weibo.com/oauth2/access_token';
const WEIBO_USERINFO_URL = 'https://api.weibo.com/2/users/show.json';

interface WeiboTokenResponse {
  access_token: string;
  expires_in: number;
  uid: string;
  remind_in?: string;
}

interface WeiboUserInfoResponse {
  id: number;
  idstr: string;
  screen_name?: string;
  name?: string;
  profile_image_url?: string;
  avatar_large?: string;
  avatar_hd?: string;
  gender?: string; // m / f / n
  location?: string;
  description?: string;
}

@Injectable()
export class WeiboOAuthProvider implements OAuthProvider, OnModuleInit {
  readonly provider = OAUTH_PROVIDER_WEIBO;

  private readonly logger = new Logger(WeiboOAuthProvider.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  buildAuthorizeUrl(state: string, callbackUri?: string): string {
    const config = this.getConfig();
    const redirectUri = callbackUri ?? config.redirectUri;

    if (!redirectUri) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_not_configured'),
      });
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.appId,
      redirect_uri: redirectUri,
      state,
    });

    return `${WEIBO_AUTHORIZE_URL}?${params.toString()}`;
  }

  async fetchProfile(
    credential: Record<string, unknown>,
  ): Promise<OAuthProfile> {
    const code = credential['code'] as string;
    if (!code) {
      unauthorized(this.i18n.t('auth.oauth_code_required'));
    }

    const config = this.getConfig();

    // Step 1: exchange code for access_token (POST + JSON)
    const token = await this.fetchAccessToken(code, config);

    // Step 2: get user info (GET with uid + access_token)
    const userInfo = await this.fetchUserInfo(token.access_token, token.uid);

    return {
      provider: OAUTH_PROVIDER_WEIBO,
      providerUserId: token.uid,
      email: null,
      nickname: userInfo.screen_name ?? userInfo.name ?? null,
      avatar:
        userInfo.avatar_hd ??
        userInfo.avatar_large ??
        userInfo.profile_image_url ??
        null,
      rawProfile: toInputJsonValue({
        uid: token.uid,
        screen_name: userInfo.screen_name ?? null,
        gender: userInfo.gender ?? null,
        location: userInfo.location ?? null,
        description: userInfo.description ?? null,
      }),
    };
  }

  onModuleInit(): void {
    const config = this.readRawConfig();
    if (!config.appId || !config.appSecret) {
      this.logger.warn(
        'Weibo OAuth is not fully configured — Weibo login will be unavailable.',
      );
    }
  }

  // ── Weibo API helpers ───────────────────────────────────────

  private async fetchAccessToken(
    code: string,
    config: { appId: string; appSecret: string; redirectUri: string },
  ): Promise<WeiboTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.appId,
      client_secret: config.appSecret,
      code,
      redirect_uri: config.redirectUri,
    });

    const response = await this.fetchWeiboApi(WEIBO_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = (await response.json()) as Record<string, unknown>;

    if ((data as { error?: string }).error) {
      unauthorized(this.i18n.t('auth.oauth_code_invalid'));
    }

    const tokenResponse = data as unknown as WeiboTokenResponse;
    if (!tokenResponse.access_token || !tokenResponse.uid) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }

    return tokenResponse;
  }

  private async fetchUserInfo(
    accessToken: string,
    uid: string,
  ): Promise<WeiboUserInfoResponse> {
    const params = new URLSearchParams({
      access_token: accessToken,
      uid,
    });

    const response = await this.fetchWeiboApi(
      `${WEIBO_USERINFO_URL}?${params.toString()}`,
    );
    const data = (await response.json()) as Record<string, unknown>;

    if ((data as { error?: string }).error) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }

    return data as unknown as WeiboUserInfoResponse;
  }

  // ── HTTP helpers ────────────────────────────────────────────

  private async fetchWeiboApi(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    try {
      return await fetchWithRetry(url, init);
    } catch (error) {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(`Weibo API request failed: ${reason}`, stack);
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
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
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
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
    return config.weibo;
  }
}
