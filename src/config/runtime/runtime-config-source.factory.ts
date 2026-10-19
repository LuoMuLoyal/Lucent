/**
 * Builds the runtime document source from the environment.
 *
 * The adapter is constructed here, not in the port file, so the port stays free
 * of the native binding: only this file and `rnacos-config-source.ts` know the
 * source is rnacos. Returning `null` rather than a no-op adapter is deliberate —
 * it makes "disabled" a branch the compiler checks (`if (source === null)`)
 * instead of a code path that silently attempts a connection.
 */

import { EnvKey } from '../env/env-keys.enum.js';
import { RnacosConfigSource } from './rnacos-config-source.js';
import type { RuntimeConfigDocumentSource } from './runtime-config-source.js';

/** Mirrors the defaults of the startup env schema (see environment.validation.ts). */
const DEFAULT_GROUP = 'LUCENT_RUNTIME';
const DEFAULT_DATA_ID = 'lucent-runtime-tuning.txt';
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

export function createRuntimeConfigDocumentSource(): RuntimeConfigDocumentSource | null {
  if (process.env[EnvKey.RNACOS_ENABLED] !== 'true') {
    return null;
  }

  return new RnacosConfigSource({
    serverAddr: process.env[EnvKey.RNACOS_SERVER_ADDR] ?? '',
    namespace: process.env[EnvKey.RNACOS_NAMESPACE] ?? '',
    group: process.env[EnvKey.RNACOS_GROUP] ?? DEFAULT_GROUP,
    dataId: process.env[EnvKey.RNACOS_DATA_ID] ?? DEFAULT_DATA_ID,
    username: process.env[EnvKey.RNACOS_USERNAME] ?? '',
    password: process.env[EnvKey.RNACOS_PASSWORD] ?? '',
    requestTimeoutMs: Number(
      process.env[EnvKey.RNACOS_REQUEST_TIMEOUT_MS] ??
        DEFAULT_REQUEST_TIMEOUT_MS,
    ),
  });
}
