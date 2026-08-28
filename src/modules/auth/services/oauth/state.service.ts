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
} from '../../../../common/result';
import { extractErrorInfo } from '../../../../common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { ConfigKey } from '../../../../config/env/config-keys.enum';
import type { YamlConfig } from '../../../../config/yaml/yaml-loader';
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
  private static readonly CACHE_KEY_PREFIX = 'auth:oauth-state';

  private readonly logger = new Logger(AuthOAuthStateService.name);
  private readonly stateTtlMs: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly configService: ConfigService,
  ) {
    const yaml = this.configService.getOrThrow<YamlConfig>(ConfigKey.Yaml);
    this.stateTtlMs = yaml.oauth.stateTtlMs;
  }

  createState(
    provider: OAuthProviderName,
    purpose: OAuthStateEntry['purpose'],
    callbackUri?: string,
  ): ResultAsync<{ state: string; ttlSec: number }, DomainFailure> {
    const state = randomBytes(24).toString('base64url');
    const normalized = this.normalizeCallbackUri(provider, callbackUri);
    if (normalized.isErr()) {
      return errAsync(normalized.error);
    }
    const normalizedUri = normalized.value;

    return fromPromise(
      this.cache
        .set(
          this.stateKey(provider, state),
          {
            provider,
            purpose,
            ...(normalizedUri !== undefined && { callbackUri: normalizedUri }),
          },
          this.stateTtlMs,
        )
        .then(() => {
          this.logger.debug(
            `OAuth state created (provider=${provider}, purpose=${purpose})`,
          );
          return { state, ttlSec: this.stateTtlMs / 1000 };
        }),
      (error) => {
        throw error;
      },
    );
  }

  consume(
    provider: OAuthProviderName,
    state: string,
    purpose: OAuthStateEntry['purpose'],
  ): ResultAsync<OAuthStateEntry, DomainFailure> {
    const key = this.stateKey(provider, state);

    return fromPromise(this.cache.get<OAuthStateEntry>(key), (error) => {
      throw error;
    })
      .andThen((entry) =>
        fromPromise(this.cache.del(key), (error) => {
          throw error;
        }).map(() => {
          this.logger.debug(
            `OAuth state consumed (provider=${provider}, purpose=${purpose})`,
          );
          return entry;
        }),
      )
      .andThen((entry) => {
        if (!this.isValidEntry(provider, entry, purpose)) {
          return errAsync(this.invalidState());
        }
        return okAsync(entry);
      });
  }

  peek(
    provider: OAuthProviderName,
    state: string,
  ): ResultAsync<OAuthStateEntry, DomainFailure> {
    return fromPromise(
      this.cache.get<OAuthStateEntry>(this.stateKey(provider, state)),
      (error) => {
        throw error;
      },
    ).andThen((entry) => {
      if (!this.isValidEntry(provider, entry)) {
        return errAsync(this.invalidState());
      }
      return okAsync(entry);
    });
  }

  buildRedirectUrl(
    entry: OAuthStateEntry,
    code: string,
    state: string,
  ): Result<string, DomainFailure> {
    if (entry.callbackUri === undefined) {
      return err(this.invalidUri());
    }
    const redirect = new URL(entry.callbackUri);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', state);
    return ok(redirect.toString());
  }

  // ── Private helpers ──

  private stateKey(provider: OAuthProviderName, state: string): string {
    const digest = createHash('sha256').update(state).digest('hex');
    return `${AuthOAuthStateService.CACHE_KEY_PREFIX}:${provider}:${digest}`;
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
  ): Result<string | undefined, DomainFailure> {
    const trimmed = uri?.trim();
    if (!trimmed) return ok(undefined);

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch (error) {
      this.logger.warn('Invalid OAuth callback URI', {
        uri: trimmed,
        error: extractErrorInfo(error).message,
      });
      return err(this.invalidUri());
    }

    const hostname = parsed.hostname.toLowerCase();
    const isLoopback =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1';

    if (parsed.username.length > 0 || parsed.password.length > 0) {
      return err(this.invalidUri());
    }

    if (isLoopback) {
      if (
        parsed.protocol !== 'http:' ||
        parsed.port.length === 0 ||
        parsed.hash.length > 0
      ) {
        return err(this.invalidUri());
      }
      parsed.search = '';
      return ok(parsed.toString());
    }

    const expectedPath = this.providerCallbackPath(provider);
    if (
      parsed.protocol !== 'https:' ||
      parsed.pathname !== expectedPath ||
      parsed.hash.length > 0 ||
      !this.isTrustedOrigin(parsed.origin)
    ) {
      return err(this.invalidUri());
    }

    parsed.search = '';
    return ok(parsed.toString());
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

  private invalidUri(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }

  private invalidState(): DomainFailure {
    return createDomainFailure({
      kind: 'authentication',
      code: 'AUTH_OAUTH_STATE_INVALID',
    });
  }
}
