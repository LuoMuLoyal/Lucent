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
import { OAUTH_PROVIDER_WEIBO, type OAuthProfile } from '../types/oauth.types';
import type { OAuthProvider } from './oauth-provider.interface';
import {
  classifyFetchError,
  dependencyBadGateway,
} from './dependency-failure.utils';

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

  constructor(private readonly configService: ConfigService) {}

  buildAuthorizeUrl(state: string, callbackUri?: string): string {
    const config = this.getConfig();
    const redirectUri = callbackUri ?? config.redirectUri;

    if (!redirectUri) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Weibo OAuth is not configured.',
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

  fetchProfile(
    credential: Record<string, unknown>,
  ): ResultAsync<OAuthProfile, DomainFailure> {
    const code = credential['code'] as string;
    if (!code) {
      return errAsync(this.validationFailure());
    }

    const config = this.getConfig();

    // Step 1: exchange code for access_token (POST + JSON)
    return this.fetchAccessToken(code, config).andThen((token) =>
      // Step 2: get user info (GET with uid + access_token)
      this.fetchUserInfo(token.access_token, token.uid).map(
        (userInfo): OAuthProfile => ({
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
        }),
      ),
    );
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

  private fetchAccessToken(
    code: string,
    config: { appId: string; appSecret: string; redirectUri: string },
  ): ResultAsync<WeiboTokenResponse, DomainFailure> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.appId,
      client_secret: config.appSecret,
      code,
      redirect_uri: config.redirectUri,
    });

    return this.fetchWeiboApi(WEIBO_ACCESS_TOKEN_URL, {
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

        const tokenResponse = data as unknown as WeiboTokenResponse;
        if (!tokenResponse.access_token || !tokenResponse.uid) {
          return errAsync(dependencyBadGateway());
        }

        return okAsync(tokenResponse);
      });
  }

  private fetchUserInfo(
    accessToken: string,
    uid: string,
  ): ResultAsync<WeiboUserInfoResponse, DomainFailure> {
    const params = new URLSearchParams({
      access_token: accessToken,
      uid,
    });

    return this.fetchWeiboApi(`${WEIBO_USERINFO_URL}?${params.toString()}`)
      .andThen((response) => this.parseJson<Record<string, unknown>>(response))
      .andThen((data) => {
        if ((data as { error?: string }).error) {
          return errAsync(dependencyBadGateway());
        }
        return okAsync(data as unknown as WeiboUserInfoResponse);
      });
  }

  // ── HTTP helpers ────────────────────────────────────────────

  private fetchWeiboApi(
    url: string,
    init?: RequestInit,
  ): ResultAsync<Response, DomainFailure> {
    return fromPromise(fetchWithRetry(url, init), (error) => {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(`Weibo API request failed: ${reason}`, stack);
      return classifyFetchError(error);
    });
  }

  private parseJson<T>(response: Response): ResultAsync<T, DomainFailure> {
    return fromPromise(response.json() as Promise<T>, (error) => {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(
        `Failed to decode Weibo API JSON response: ${reason}`,
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
        message: 'Weibo OAuth is not configured.',
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

  private validationFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }
}
