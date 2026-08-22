import { badRequest } from '../../../../common';
import { extractErrorInfo } from '../../../../common';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { I18nService } from 'nestjs-i18n';
import { ConfigKey } from '../../../../config/env/config-keys.enum';
import { EnvKey } from '../../../../config/env/env-keys.enum';
import { DEFAULT_OAUTH_STATE_TTL_MS } from '../../../../config/constants';
import {
  OAUTH_PROVIDER_WECHAT_WEB,
  OAUTH_PROVIDER_QQ,
  OAUTH_PROVIDER_WEIBO,
  OAUTH_PROVIDER_GOOGLE,
  type OAuthProviderName,
} from '../../types/oauth.types';

interface OAuthStateEntry {
  provider: OAuthProviderName;
  purpose: 'login' | 'link';
  callbackUri?: string;
}

export type { OAuthStateEntry };

@Injectable()
export class AuthOAuthStateService {
  private readonly logger = new Logger(AuthOAuthStateService.name);
  private readonly stateTtlMs: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {
    this.stateTtlMs = this.configService.get<number>(
      EnvKey.OAUTH_STATE_TTL_MS,
      DEFAULT_OAUTH_STATE_TTL_MS,
    );
  }

  async createState(
    provider: OAuthProviderName,
    purpose: OAuthStateEntry['purpose'],
    callbackUri?: string,
  ): Promise<{ state: string; ttlSec: number }> {
    const state = randomBytes(24).toString('base64url');
    const normalizedUri = this.normalizeCallbackUri(provider, callbackUri);
    await this.cache.set(
      this.stateKey(provider, state),
      {
        provider,
        purpose,
        ...(normalizedUri !== undefined && { callbackUri: normalizedUri }),
      },
      this.stateTtlMs,
    );
    this.logger.debug(
      `OAuth state created (provider=${provider}, purpose=${purpose})`,
    );
    return { state, ttlSec: this.stateTtlMs / 1000 };
  }

  async consume(
    provider: OAuthProviderName,
    state: string,
    purpose: OAuthStateEntry['purpose'],
  ): Promise<OAuthStateEntry> {
    const key = this.stateKey(provider, state);
    const entry = await this.cache.get<OAuthStateEntry>(key);
    await this.cache.del(key);
    this.logger.debug(
      `OAuth state consumed (provider=${provider}, purpose=${purpose})`,
    );
    if (!this.isValidEntry(provider, entry, purpose)) {
      throw this.invalidState();
    }
    return entry;
  }

  async peek(
    provider: OAuthProviderName,
    state: string,
  ): Promise<OAuthStateEntry> {
    const entry = await this.cache.get<OAuthStateEntry>(
      this.stateKey(provider, state),
    );
    if (!this.isValidEntry(provider, entry)) {
      throw this.invalidState();
    }
    return entry;
  }

  buildRedirectUrl(
    entry: OAuthStateEntry,
    code: string,
    state: string,
  ): string {
    if (entry.callbackUri === undefined) {
      badRequest(this.i18n.t('auth.oauth_callback_uri_missing'));
    }
    const redirect = new URL(entry.callbackUri);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', state);
    return redirect.toString();
  }

  // ── Private helpers ──

  private stateKey(provider: OAuthProviderName, state: string): string {
    const digest = createHash('sha256').update(state).digest('hex');
    return `auth:oauth-state:${provider}:${digest}`;
  }

  private isValidEntry(
    provider: OAuthProviderName,
    entry: unknown,
    purpose?: OAuthStateEntry['purpose'],
  ): entry is OAuthStateEntry {
    if (typeof entry !== 'object' || entry === null) return false;
    const candidate = entry as Partial<OAuthStateEntry>;
    return (
      candidate.provider === provider &&
      (candidate.purpose === 'login' || candidate.purpose === 'link') &&
      (purpose === undefined || candidate.purpose === purpose) &&
      (candidate.callbackUri === undefined ||
        typeof candidate.callbackUri === 'string')
    );
  }

  private normalizeCallbackUri(
    provider: OAuthProviderName,
    uri: string | undefined,
  ): string | undefined {
    const trimmed = uri?.trim();
    if (!trimmed) return undefined;

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch (error) {
      this.logger.warn('Invalid OAuth callback URI', {
        uri: trimmed,
        error: extractErrorInfo(error).message,
      });
      throw this.invalidUri();
    }

    const hostname = parsed.hostname.toLowerCase();
    const isLoopback =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1';

    if (parsed.username.length > 0 || parsed.password.length > 0) {
      throw this.invalidUri();
    }

    if (isLoopback) {
      if (
        parsed.protocol !== 'http:' ||
        parsed.port.length === 0 ||
        parsed.hash.length > 0
      ) {
        throw this.invalidUri();
      }
      parsed.search = '';
      return parsed.toString();
    }

    const expectedPath = this.providerCallbackPath(provider);
    if (
      parsed.protocol !== 'https:' ||
      parsed.pathname !== expectedPath ||
      parsed.hash.length > 0 ||
      !this.isTrustedOrigin(parsed.origin)
    ) {
      throw this.invalidUri();
    }

    parsed.search = '';
    return parsed.toString();
  }

  private providerCallbackPath(provider: OAuthProviderName): string {
    switch (provider) {
      case OAUTH_PROVIDER_WECHAT_WEB:
        return '/login/oauth/wechat';
      case OAUTH_PROVIDER_QQ:
        return '/login/oauth/qq';
      case OAUTH_PROVIDER_WEIBO:
        return '/login/oauth/weibo';
      case OAUTH_PROVIDER_GOOGLE:
        return '/login/oauth/google';
      default:
        return '/login/oauth/wechat';
    }
  }

  private isTrustedOrigin(origin: string): boolean {
    const corsOrigin = this.configService.get<boolean | string[]>(
      `${ConfigKey.App}.corsOrigin`,
      false,
    );
    return Array.isArray(corsOrigin) && corsOrigin.includes(origin);
  }

  private invalidUri(): BadRequestException {
    return new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: this.i18n.t('auth.oauth_callback_uri_invalid'),
    });
  }

  private invalidState(): BadRequestException {
    return new BadRequestException({
      code: 'AUTH_OAUTH_STATE_INVALID',
      message: this.i18n.t('auth.oauth_state_invalid'),
    });
  }
}
