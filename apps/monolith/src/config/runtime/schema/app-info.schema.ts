/**
 * App-info family: the values the client's "about"/update screen reads.
 *
 * These are not secrets and not startup wiring; they are read per request, so a
 * change is visible on the next call. Baselines mirror the corresponding env
 * keys (empty when unset, which the client contract already treats as "not
 * configured").
 */

import { EnvKey } from '../../env/env-keys.enum.js';
import {
  emailValidator,
  nullableStringField,
  type RuntimeFieldSpec,
} from './field-spec.js';

const HTTP_URL = (value: string): string | null =>
  /^https?:\/\/\S+$/u.test(value) ? null : 'must be an http or https URL';

export const appInfoRuntimeFields = {
  [EnvKey.SUPPORT_EMAIL]: nullableStringField({
    family: 'app-info',
    validate: emailValidator,
  }),
  [EnvKey.MIN_CLIENT_VERSION]: nullableStringField({ family: 'app-info' }),
  [EnvKey.LATEST_VERSION]: nullableStringField({ family: 'app-info' }),
  [EnvKey.DOWNLOAD_URL]: nullableStringField({
    family: 'app-info',
    validate: HTTP_URL,
  }),
} satisfies Record<string, RuntimeFieldSpec<unknown>>;
