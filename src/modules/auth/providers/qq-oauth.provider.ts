import {
  extractErrorInfo,
  fetchWithRetry,
  toInputJsonValue,
} from '../../../common';
import {
  createDomainFailure,
  err,
  errAsync,
  fromPromise,
  ok,
  okAsync,
  type DomainFailure,
  type Result,
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
import { OAUTH_PROVIDER_QQ, type OAuthProfile } from '../types/oauth.types';
import type { OAuthProvider } from './oauth-provider.interface';
import {
  classifyFetchError,
  dependencyBadGateway,
} from './dependency-failure.utils';

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

  constructor(private readonly configService: ConfigService) {}

  buildAuthorizeUrl(state: string, callbackUri?: string): string {
    const config = this.getConfig();
    const redirectUri = callbackUri ?? config.redirectUri;

    if (!redirectUri) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'QQ OAuth is not configured.',
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

  fetchProfile(
    credential: Record<string, unknown>,
  ): ResultAsync<OAuthProfile, DomainFailure> {
    const code = credential['code'] as string;
    if (!code) {
      return errAsync(this.validationFailure());
    }

    const config = this.getConfig();

    // Step 1: exchange code for access_token
    return this.fetchAccessToken(code, config).andThen((token) =>
      // Step 2: get openid
      this.fetchOpenId(token.access_token).andThen((openid) =>
        // Step 3: get user info
        this.fetchUserInfo(token.access_token, openid, config.appId).map(
          (userInfo): OAuthProfile => ({
            provider: OAUTH_PROVIDER_QQ,
            providerUserId: openid,
            email: null,
            nickname: userInfo.nickname ?? null,
            avatar:
              userInfo.figureurl_qq_2 ??
              userInfo.figureurl_qq_1 ??
              userInfo.figureurl ??
              null,
            rawProfile: toInputJsonValue({
              openid,
              nickname: userInfo.nickname ?? null,
              gender: userInfo.gender ?? null,
              figureurl: userInfo.figureurl ?? null,
              figureurl_qq_2: userInfo.figureurl_qq_2 ?? null,
            }),
          }),
        ),
      ),
    );
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

  private fetchAccessToken(
    code: string,
    config: { appId: string; appSecret: string; redirectUri: string },
  ): ResultAsync<QqTokenResponse, DomainFailure> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.appId,
      client_secret: config.appSecret,
      code,
      redirect_uri: config.redirectUri,
    });

    return this.fetchQqApi(`${QQ_ACCESS_TOKEN_URL}?${params.toString()}`)
      .andThen((response) =>
        fromPromise(response.text(), (error) => {
          this.logger.error(
            `Failed to read QQ token response: ${extractErrorInfo(error).message}`,
            extractErrorInfo(error).stack,
          );
          return dependencyBadGateway(error);
        }),
      )
      .andThen((text) => {
        // QQ returns query-string format or JSON with error
        if (text.includes('callback(')) {
          const parsed = this.extractJsonp(text);
          if (parsed.isErr()) return errAsync(parsed.error);
          return errAsync(dependencyBadGateway());
        }

        const parsed = this.parseQueryString(text);
        if (parsed['error']) {
          return errAsync(dependencyBadGateway());
        }

        if (!parsed['access_token']) {
          return errAsync(dependencyBadGateway());
        }

        return okAsync({
          access_token: parsed['access_token'],
          expires_in: parsed['expires_in'] ?? '0',
          refresh_token: parsed['refresh_token'] ?? '',
        });
      });
  }

  private fetchOpenId(accessToken: string): ResultAsync<string, DomainFailure> {
    const params = new URLSearchParams({
      access_token: accessToken,
      fmt: 'json',
    });

    return this.fetchQqApi(`${QQ_OPENID_URL}?${params.toString()}`)
      .andThen((response) =>
        fromPromise(response.text(), (error) => {
          this.logger.error(
            `Failed to read QQ openid response: ${extractErrorInfo(error).message}`,
            extractErrorInfo(error).stack,
          );
          return dependencyBadGateway(error);
        }),
      )
      .andThen((text) => {
        // QQ me endpoint may return JSONP or JSON
        const parsed = text.includes('callback(')
          ? this.extractJsonp(text)
          : this.safeJsonParse(text);
        return parsed.match(
          (data) => {
            if ((data as { error?: number }).error !== undefined) {
              return errAsync(dependencyBadGateway());
            }

            const openIdResponse = data as unknown as QqOpenIdResponse;
            if (!openIdResponse.openid) {
              return errAsync(dependencyBadGateway());
            }

            return okAsync(openIdResponse.openid);
          },
          (failure) => errAsync(failure),
        );
      });
  }

  private fetchUserInfo(
    accessToken: string,
    openid: string,
    oauthConsumerKey: string,
  ): ResultAsync<QqUserInfoResponse, DomainFailure> {
    const params = new URLSearchParams({
      access_token: accessToken,
      oauth_consumer_key: oauthConsumerKey,
      openid,
    });

    return this.fetchQqApi(`${QQ_USERINFO_URL}?${params.toString()}`)
      .andThen((response) => this.parseJson<QqUserInfoResponse>(response))
      .andThen((data) => {
        if (data.ret !== 0) {
          return errAsync(dependencyBadGateway());
        }
        return okAsync(data);
      });
  }

  // ── HTTP helpers ────────────────────────────────────────────

  private fetchQqApi(url: string): ResultAsync<Response, DomainFailure> {
    return fromPromise(fetchWithRetry(url), (error) => {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(`QQ API request failed: ${reason}`, stack);
      return classifyFetchError(error);
    });
  }

  private parseJson<T>(response: Response): ResultAsync<T, DomainFailure> {
    return fromPromise(response.json() as Promise<T>, (error) => {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(
        `Failed to decode QQ API JSON response: ${reason}`,
        stack,
      );
      return dependencyBadGateway(error);
    });
  }

  private extractJsonp(
    text: string,
  ): Result<Record<string, unknown>, DomainFailure> {
    const match = text.match(/callback\s*\(\s*(.*?)\s*\)\s*;?\s*$/s);
    if (match) {
      return this.safeJsonParse(match[1] ?? '');
    }
    return this.safeJsonParse(text);
  }

  private safeJsonParse(
    text: string,
  ): Result<Record<string, unknown>, DomainFailure> {
    try {
      return ok(JSON.parse(text) as Record<string, unknown>);
    } catch (error) {
      this.logger.warn('Failed to parse QQ OAuth JSON response', {
        text: text.slice(0, 200),
        error,
      });
      return err(dependencyBadGateway());
    }
  }

  private parseQueryString(qs: string): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(qs));
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
        message: 'QQ OAuth is not configured.',
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

  private validationFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }
}
