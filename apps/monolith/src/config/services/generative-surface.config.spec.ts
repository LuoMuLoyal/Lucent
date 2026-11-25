import { ConfigKey } from '../env/config-keys.enum.js';
import { EnvKey } from '../env/env-keys.enum.js';
import { generativeSurfaceConfig } from './generative-surface.config.js';

describe('generativeSurfaceConfig', () => {
  const saved = process.env[EnvKey.A2UI_CATALOG_ID];

  beforeEach(() => {
    Reflect.deleteProperty(process.env, EnvKey.A2UI_CATALOG_ID);
  });

  afterEach(() => {
    if (saved === undefined) {
      Reflect.deleteProperty(process.env, EnvKey.A2UI_CATALOG_ID);
    } else {
      process.env[EnvKey.A2UI_CATALOG_ID] = saved;
    }
  });

  it('is registered under ConfigKey.GenerativeSurface', () => {
    expect(generativeSurfaceConfig.KEY).toContain(ConfigKey.GenerativeSurface);
  });

  it('defaults to an empty catalog id', () => {
    // Empty is a supported state: the prompt then tells the model to copy the
    // client's id instead of asserting one the deployment never chose.
    expect(generativeSurfaceConfig()).toEqual({ catalogId: '' });
  });

  it('reads A2UI_CATALOG_ID', () => {
    process.env[EnvKey.A2UI_CATALOG_ID] = 'https://example.test/catalog.json';

    expect(generativeSurfaceConfig().catalogId).toBe(
      'https://example.test/catalog.json',
    );
  });

  it('trims surrounding whitespace', () => {
    process.env[EnvKey.A2UI_CATALOG_ID] = '  com.example.catalog  ';

    expect(generativeSurfaceConfig().catalogId).toBe('com.example.catalog');
  });

  it('treats a whitespace-only value as unset', () => {
    process.env[EnvKey.A2UI_CATALOG_ID] = '   ';

    expect(generativeSurfaceConfig().catalogId).toBe('');
  });
});
