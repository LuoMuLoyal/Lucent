/**
 * Auth family: TTLs for issued or verified artefacts.
 *
 * Every value here is read when something is issued or checked, so a change
 * affects new artefacts only — an access token already signed keeps its own
 * expiry, and a verification code already stored keeps its own TTL.
 *
 * Baselines mirror `environment.validation.ts` defaults and
 * `DEFAULT_JWT_*_TTL_SECONDS` in `config/app-defaults.constants.ts`; the JWT
 * values accept the same duration syntax as `.env` (`15m`, `2h`, `14d`).
 */

import { EnvKey } from '../../env/env-keys.enum.js';
import {
  DEFAULT_JWT_ACCESS_TTL_SECONDS,
  DEFAULT_JWT_REFRESH_TTL_SECONDS,
} from '../../app-defaults.constants.js';
import {
  durationSecondsField,
  numberField,
  type RuntimeFieldSpec,
} from './field-spec.js';

const MIN_TTL_MS = 1_000;
const MAX_TTL_MS = 2_592_000_000;

const MIN_CODE_LENGTH = 4;
const MAX_CODE_LENGTH = 8;

/** Access tokens are short-lived by design; refresh tokens get a wider ceiling. */
const MIN_JWT_TTL_SECONDS = 60;
const MAX_JWT_ACCESS_TTL_SECONDS = 2_592_000;
const MAX_JWT_REFRESH_TTL_SECONDS = 7_776_000;

export const authRuntimeFields = {
  [EnvKey.VERIFICATION_CODE_TTL_MS]: numberField({
    family: 'auth',
    min: MIN_TTL_MS,
    max: MAX_TTL_MS,
    defaultValue: 300_000,
  }),
  [EnvKey.VERIFICATION_COOLDOWN_MS]: numberField({
    family: 'auth',
    min: 0,
    max: 86_400_000,
    defaultValue: 60_000,
  }),
  [EnvKey.VERIFICATION_RATE_LIMIT_WINDOW_MS]: numberField({
    family: 'auth',
    min: MIN_TTL_MS,
    max: MAX_TTL_MS,
    defaultValue: 600_000,
  }),
  [EnvKey.VERIFICATION_RATE_LIMIT_MAX]: numberField({
    family: 'auth',
    min: 1,
    max: 100_000,
    defaultValue: 20,
  }),
  [EnvKey.VERIFICATION_CODE_LENGTH]: numberField({
    family: 'auth',
    min: MIN_CODE_LENGTH,
    max: MAX_CODE_LENGTH,
    defaultValue: 6,
  }),
  [EnvKey.OAUTH_STATE_TTL_MS]: numberField({
    family: 'auth',
    min: MIN_TTL_MS,
    max: MAX_TTL_MS,
    defaultValue: 600_000,
  }),
  [EnvKey.JWT_ACCESS_TTL]: durationSecondsField({
    family: 'auth',
    min: MIN_JWT_TTL_SECONDS,
    max: MAX_JWT_ACCESS_TTL_SECONDS,
    defaultValue: DEFAULT_JWT_ACCESS_TTL_SECONDS,
  }),
  [EnvKey.JWT_REFRESH_TTL]: durationSecondsField({
    family: 'auth',
    min: MIN_JWT_TTL_SECONDS,
    max: MAX_JWT_REFRESH_TTL_SECONDS,
    defaultValue: DEFAULT_JWT_REFRESH_TTL_SECONDS,
  }),
} satisfies Record<string, RuntimeFieldSpec<unknown>>;
