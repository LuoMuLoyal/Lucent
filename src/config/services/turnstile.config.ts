import { registerAs } from '@nestjs/config';

import { ConfigKey } from '../env/config-keys.enum.js';
import { EnvKey } from '../env/env-keys.enum.js';

/**
 * Cloudflare Turnstile configuration.
 *
 * `secretKey` stays server-side and is never exposed to clients; `siteKey` is
 * public by design (the widget needs it) and is served through the
 * `GET /auth/captcha-config` endpoint so a client never hardcodes it.
 *
 * An empty `secretKey` means verification is disabled — the guard treats every
 * request as human. That is the local-dev and e2e default; production sets it.
 */
export interface TurnstileConfig {
  secretKey: string;
  siteKey: string;
  /** Whether the challenge is enforced at all. */
  enabled: boolean;
}

export const turnstileConfig = registerAs(
  ConfigKey.Turnstile,
  (): TurnstileConfig => {
    const secretKey = (process.env[EnvKey.TURNSTILE_SECRET_KEY] ?? '').trim();
    const siteKey = (process.env[EnvKey.TURNSTILE_SITE_KEY] ?? '').trim();

    return {
      secretKey,
      siteKey,
      // Both halves are required: a secret without a site key cannot render a
      // widget, so treating that state as "enabled" would lock every client out.
      enabled: secretKey.length > 0 && siteKey.length > 0,
    };
  },
);
