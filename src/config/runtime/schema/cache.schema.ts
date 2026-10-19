/**
 * Cache family: TTLs for the caches whose entries are safe to age differently.
 *
 * Baselines mirror `modules/medicines/cache/store.constants.ts` and
 * `DEFAULT_RESULT_TTL_MS` in `common/queue/base-async-queue.service.ts`. The
 * remote key name for the safety-tips TTL is `MEDICINES_SAFETY_TIPS_CACHE_TTL_MS`
 * (the code constant is `MEDICINES_SAFETY_TIPS_TTL_MS`).
 *
 * Verification codes, sessions and share tokens are deliberately absent: their
 * TTLs are correctness, not tuning.
 */

import { EnvKey } from '../../env/env-keys.enum.js';
import { numberField, type RuntimeFieldSpec } from './field-spec.js';

const MIN_TTL_MS = 1_000;
const MAX_TTL_MS = 2_592_000_000;

export const cacheRuntimeFields = {
  [EnvKey.MEDICINES_SEARCH_CACHE_TTL_MS]: numberField({
    family: 'cache',
    min: MIN_TTL_MS,
    max: MAX_TTL_MS,
    defaultValue: 300_000,
  }),
  [EnvKey.MEDICINES_DETAIL_CACHE_TTL_MS]: numberField({
    family: 'cache',
    min: MIN_TTL_MS,
    max: MAX_TTL_MS,
    defaultValue: 900_000,
  }),
  [EnvKey.MEDICINES_SAFETY_TIPS_CACHE_TTL_MS]: numberField({
    family: 'cache',
    min: MIN_TTL_MS,
    max: MAX_TTL_MS,
    defaultValue: 1_800_000,
  }),
  [EnvKey.ASYNC_JOB_RESULT_CACHE_TTL_MS]: numberField({
    family: 'cache',
    min: MIN_TTL_MS,
    max: MAX_TTL_MS,
    defaultValue: 1_800_000,
  }),
} satisfies Record<string, RuntimeFieldSpec<unknown>>;
