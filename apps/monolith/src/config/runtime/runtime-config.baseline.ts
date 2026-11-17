/**
 * Environment baseline for the runtime snapshot.
 *
 * The rule is the same for every key: a value present in the environment wins,
 * otherwise the field spec's default (the code constant) applies. There is no
 * third layer — the remote document only replaces keys it names, and a rejected
 * document leaves this baseline in place.
 *
 * Reading happens once, at startup, so the baseline cannot drift while the
 * process runs; a value that needs to change at runtime is a remote override by
 * definition.
 */

import {
  resolveFieldDefault,
  type RuntimeFieldSpec,
} from './schema/field-spec.js';
import {
  RUNTIME_CONFIG_FIELDS,
  RUNTIME_CONFIG_KEYS,
  type RuntimeConfigKey,
  type RuntimeConfigValues,
} from './runtime-config.schema.js';

/** Version string of the startup snapshot (no document has been applied yet). */
export const BASELINE_RUNTIME_CONFIG_VERSION = 'env#0';

function readEnvironmentValue(key: RuntimeConfigKey): string | null {
  const raw = process.env[key]?.trim();
  return raw === undefined || raw === '' ? null : raw;
}

function resolveKey<K extends RuntimeConfigKey>(
  key: K,
): RuntimeConfigValues[K] {
  const spec = RUNTIME_CONFIG_FIELDS[key] as RuntimeFieldSpec<
    RuntimeConfigValues[K]
  >;
  const raw = readEnvironmentValue(key);
  if (raw !== null) {
    const parsed = spec.parse(raw);
    if (parsed.ok) {
      return parsed.value;
    }
  }
  return resolveFieldDefault(spec);
}

/** Builds the startup snapshot values from the environment. */
export function buildRuntimeConfigBaseline(): RuntimeConfigValues {
  const values = {} as RuntimeConfigValues;
  const target = values as Record<string, unknown>;
  for (const key of RUNTIME_CONFIG_KEYS) {
    target[key] = resolveKey(key);
  }
  return values;
}
