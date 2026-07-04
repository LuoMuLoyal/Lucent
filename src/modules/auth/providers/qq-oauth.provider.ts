import { unauthorized } from '../../../common/utils/api-errors';
import { fetchWithRetry } from '../../../common/utils/retry.utils';
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import type { Prisma } from '#generated/prisma/client';
import { ResultCode } from '../../../common/api-envelope';
import { ConfigKey } from '../../../config/config-keys.enum';
import type { OAuthConfig } from '../../../config/oauth.config';
import { OAUTH_PROVIDER_QQ, type OAuthProfile } from '../types/oauth.types';
import type { OAuthProvider } from './oauth-provider.interface';

const QQ_AUTHORIZE_URL = 'https://graph.qq.com/oauth2.0/authorize';
const QQ_ACCESS_TOKEN_URL = 'https://graph.qq.com/oauth2.0/token';
const QQ_OPENID_URL = 'https://graph.qq.com/oauth2.0/me';
const QQ_USERINFO_URL = 'https://graph.qq.com/user/get_user_info';
const QQ_SCOPE = 'get_user_info';

interface QqTokenResponse {
  access_token: string;
  expires_in: string;
  refresh_token: string;
}

interface QqOpenIdResponse {
  client_id: string;
  openid: string;
}

interface QqUserInfoResponse {
  ret: number;
  msg: string;
  nickname?: string;
  figureurl?: string;
  figureurl_1?: string;
  figureurl_2?: string;
  figureurl_qq_1?: string;
  figureurl_qq_2?: string;
  gender?: string;
  is_yellow_vip?: string;
  vip?: string;
  yellow_vip_level?: string;
  level?: string;
  is_yellow_year_vip?: string;
}

@Injectable()
export class QqOAuthProvider implements OAuthProvider, OnModuleInit {
  readonly provider = OAUTH_PROVIDER_QQ;

  private readonly logger = new Logger(QqOAuthProvider.name);

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
      scope: QQ_SCOPE,
      state,
    });

    return `${QQ_AUTHORIZE_URL}?${params.toString()}`;
  }

  async fetchProfile(
    credential: Record<string, unknown>,
  ): Promise<OAuthProfile> {
    const code = credential['code'] as string;
    if (!code) {
      unauthorized(this.i18n.t('auth.oauth_code_required'));
    }

    const config = this.getConfig();

    // Step 1: exchange code for access_token
    const token = await this.fetchAccessToken(code, config);

    // Step 2: get openid
    const openid = await this.fetchOpenId(token.access_token);

    // Step 3: get user info
    const userInfo = await this.fetchUserInfo(
      token.access_token,
      openid,
      config.appId,
    );

    return {
      provider: OAUTH_PROVIDER_QQ,
      providerUserId: openid,
      email: null,
      nickname: userInfo.nickname ?? null,
      avatar:
        userInfo.figureurl_qq_2 ??
        userInfo.figureurl_qq_1 ??
        userInfo.figureurl ??
        null,
      rawProfile: {
        openid,
        nickname: userInfo.nickname ?? null,
        gender: userInfo.gender ?? null,
        figureurl: userInfo.figureurl ?? null,
        figureurl_qq_2: userInfo.figureurl_qq_2 ?? null,
      } as Prisma.InputJsonValue,
    };
  }

  onModuleInit(): void {
    const config = this.readRawConfig();
    if (!config.appId || !config.appSecret) {
      this.logger.warn(
        'QQ OAuth is not fully configured — QQ login will be unavailable.',
      );
    }
  }

  // ── QQ API helpers ──────────────────────────────────────────

  private async fetchAccessToken(
    code: string,
    config: { appId: string; appSecret: string; redirectUri: string },
  ): Promise<QqTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.appId,
      client_secret: config.appSecret,
      code,
      redirect_uri: config.redirectUri,
    });

    const response = await this.fetchQqApi(
      `${QQ_ACCESS_TOKEN_URL}?${params.toString()}`,
    );
    const text = await response.text();

    // QQ returns query-string format or JSON with error
    if (text.includes('callback(')) {
      const json = this.extractJsonp(text);
      if ((json as { error?: number }).error !== undefined) {
        unauthorized(this.i18n.t('auth.oauth_code_invalid'));
      }
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }

    const parsed = this.parseQueryString(text);
    if (parsed['error']) {
      unauthorized(this.i18n.t('auth.oauth_code_invalid'));
    }

    if (!parsed['access_token']) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }

    return {
      access_token: parsed['access_token'],
      expires_in: parsed['expires_in'] ?? '0',
      refresh_token: parsed['refresh_token'] ?? '',
    };
  }

  private async fetchOpenId(accessToken: string): Promise<string> {
    const params = new URLSearchParams({
      access_token: accessToken,
      fmt: 'json',
    });

    const response = await this.fetchQqApi(
      `${QQ_OPENID_URL}?${params.toString()}`,
    );
    const text = await response.text();

    // QQ me endpoint may return JSONP or JSON
    const data = text.includes('callback(')
      ? this.extractJsonp(text)
      : (JSON.parse(text) as Record<string, unknown>);

    if ((data as { error?: number }).error !== undefined) {
      unauthorized(this.i18n.t('auth.oauth_code_invalid'));
    }

    const openIdResponse = data as unknown as QqOpenIdResponse;
    if (!openIdResponse.openid) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }

    return openIdResponse.openid;
  }

  private async fetchUserInfo(
    accessToken: string,
    openid: string,
    oauthConsumerKey: string,
  ): Promise<QqUserInfoResponse> {
    const params = new URLSearchParams({
      access_token: accessToken,
      oauth_consumer_key: oauthConsumerKey,
      openid,
    });

    const response = await this.fetchQqApi(
      `${QQ_USERINFO_URL}?${params.toString()}`,
    );
    const data = (await response.json()) as QqUserInfoResponse;

    if (data.ret !== 0) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }

    return data;
  }

  // ── HTTP helpers ────────────────────────────────────────────

  private async fetchQqApi(url: string): Promise<Response> {
    try {
      return await fetchWithRetry(url);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `QQ API request failed: ${reason}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }
  }

  private extractJsonp(text: string): Record<string, unknown> {
    const match = text.match(/callback\s*\(\s*(.*?)\s*\)\s*;?\s*$/s);
    if (match) {
      return JSON.parse(match[1] ?? '') as Record<string, unknown>;
    }
    return JSON.parse(text) as Record<string, unknown>;
  }

  private parseQueryString(qs: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const pair of qs.split('&')) {
      const [key, ...rest] = pair.split('=');
      if (key) {
        result[key] = rest.join('=');
      }
    }
    return result;
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
    return config.qq;
  }
}
