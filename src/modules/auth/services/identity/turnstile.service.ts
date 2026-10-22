import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { ConfigKey } from '../../../../config/env/config-keys.enum.js';
import type { TurnstileConfig } from '../../../../config/services/turnstile.config.js';

/** Cloudflare's verification endpoint. */
const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * How long to wait on Cloudflare before giving up. Kept short: this call sits
 * on the sign-in path, and a slow Cloudflare must not become a slow login.
 */
const VERIFY_TIMEOUT_MS = 3000;

/** Injection token for the fetcher seam; never bound in production. */
export const TURNSTILE_FETCH = Symbol('TURNSTILE_FETCH');

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Outcome of asking Cloudflare about a token.
 *
 * - `passed`   — Cloudflare said the token is good.
 * - `rejected` — Cloudflare said the token is bad. A real verdict.
 * - `unknown`  — we could not get an answer (network, timeout, 5xx, bad body).
 */
type Verdict = 'passed' | 'rejected' | 'unknown';

/**
 * Verifies Cloudflare Turnstile challenges.
 *
 * Failure policy, in order of importance:
 *
 * - **Fail open when we have no answer.** If Cloudflare is unreachable, slow or
 *   returning non-2xx, the request is allowed and the problem is logged. A
 *   verification outage must not become a sign-in outage; the rate limiter and
 *   the password rules still stand between an attacker and an account.
 * - **Fail closed on a negative answer.** A well-formed `success: false` is a
 *   real rejection and surfaces as `AUTH_CAPTCHA_INVALID`.
 * - **Disabled means allowed.** With no credentials configured (local dev, e2e)
 *   every token passes, so tests need no Cloudflare account.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private readonly config: TurnstileConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    // Not a DI dependency: this is only a seam for tests to inject a stub
    // fetcher. `@Optional()` keeps Nest from trying to resolve `fetch` as a
    // provider, which it would otherwise do for any constructor parameter.
    @Optional() @Inject(TURNSTILE_FETCH) fetchImpl?: typeof fetch,
  ) {
    this.config =
      configService.get<TurnstileConfig>(ConfigKey.Turnstile) ??
      ({
        secretKey: '',
        siteKey: '',
        enabled: false,
      } satisfies TurnstileConfig);
    this.fetchImpl = fetchImpl ?? fetch;
  }

  /** Whether the challenge is enforced in this deployment. */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Public site key handed to clients so they can render the widget. */
  get siteKey(): string {
    return this.config.siteKey;
  }

  /**
   * Verifies a client-supplied Turnstile token.
   *
   * @param token the `cf-turnstile-response` value from the client
   * @param remoteIp client IP, forwarded to Cloudflare for extra signal
   */
  verify(
    token: string | undefined,
    remoteIp?: string,
  ): ResultAsync<void, DomainFailure> {
    if (!this.config.enabled) return okAsync(undefined);

    if (!token || token.trim().length === 0) {
      return errAsync(
        createDomainFailure({
          kind: 'authorization',
          code: 'AUTH_CAPTCHA_REQUIRED',
        }),
      );
    }

    // askCloudflare never throws — it reduces every failure mode to a Verdict —
    // so this promise can only resolve. `fromPromise` still needs a mapper for
    // the type signature; it is unreachable in practice.
    return fromPromise<Verdict, DomainFailure>(
      this.askCloudflare(token, remoteIp),
      (error) => {
        this.logger.warn(`Turnstile verdict mapping failed: ${String(error)}`);
        return createDomainFailure({
          kind: 'dependency',
          code: 'DEPENDENCY_UNAVAILABLE',
          cause: error,
        });
      },
    )
      .map((verdict): Verdict => verdict)
      .andThen((verdict) => {
        if (verdict === 'passed') return okAsync(undefined);
        if (verdict === 'unknown') {
          // Dependency failure: allow the request, but never silently.
          this.logger.warn(
            'Turnstile verification unavailable, allowing request (fail open)',
          );
          return okAsync(undefined);
        }
        return errAsync(
          createDomainFailure({
            kind: 'authorization',
            code: 'AUTH_CAPTCHA_INVALID',
          }),
        );
      });
  }

  /** Asks Cloudflare and reduces every failure mode to the `Verdict` union. */
  private async askCloudflare(
    token: string,
    remoteIp?: string,
  ): Promise<Verdict> {
    const body = new URLSearchParams({
      secret: this.config.secretKey,
      response: token,
    });
    if (remoteIp) body.set('remoteip', remoteIp);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, VERIFY_TIMEOUT_MS);

    try {
      const response = await this.fetchImpl(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          `Turnstile siteverify responded ${String(response.status)}`,
        );
        return 'unknown';
      }

      const payload = (await response.json()) as SiteverifyResponse;
      if (payload.success) return 'passed';

      this.logger.warn(
        `Turnstile rejected a challenge: ${(payload['error-codes'] ?? []).join(',')}`,
      );
      return 'rejected';
    } catch (error) {
      this.logger.warn(`Turnstile siteverify call failed: ${String(error)}`);
      return 'unknown';
    } finally {
      clearTimeout(timer);
    }
  }
}
