import { registerAs } from '@nestjs/config';

import { ConfigKey } from '../env/config-keys.enum.js';
import { EnvKey } from '../env/env-keys.enum.js';

/**
 * A2UI generative-surface configuration.
 *
 * ## Why the catalog id is configuration
 *
 * A2UI's `catalogId` is an arbitrary string identifier the renderer and agent
 * agree on — the spec does not require it to resolve to anything. But it **is**
 * a published identifier: it namespaces the component vocabulary the client
 * advertises and appears in every `createSurface` the model emits.
 *
 * That makes it a deployment fact, not a code fact: a fork, a white-label build
 * or a self-hosted instance must be able to name its own catalog without a
 * patch. Hardcoding one would pick an identifier (and, if it looks like a URL, a
 * domain) on the deployment's behalf.
 *
 * When unset, the prompt falls back to describing the catalog by whatever id the
 * client sent in its capabilities document, so a deployment that leaves this
 * empty still works — it just cannot instruct the model to use a specific id.
 */
export interface GenerativeSurfaceConfig {
  /**
   * Catalog id the model should put in `createSurface.catalogId`.
   *
   * Empty when the deployment names none; prompts then avoid pinning an id.
   */
  catalogId: string;
}

export const generativeSurfaceConfig = registerAs(
  ConfigKey.GenerativeSurface,
  (): GenerativeSurfaceConfig => ({
    catalogId: (process.env[EnvKey.A2UI_CATALOG_ID] ?? '').trim(),
  }),
);
