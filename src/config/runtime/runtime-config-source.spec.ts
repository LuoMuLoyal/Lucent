import { EnvKey } from '../env/env-keys.enum.js';
import { RnacosConfigSource } from './rnacos-config-source.js';
import { createRuntimeConfigDocumentSource } from './runtime-config-source.factory.js';

const MANAGED_KEYS = [
  EnvKey.RNACOS_ENABLED,
  EnvKey.RNACOS_SERVER_ADDR,
  EnvKey.RNACOS_NAMESPACE,
  EnvKey.RNACOS_GROUP,
  EnvKey.RNACOS_DATA_ID,
  EnvKey.RNACOS_USERNAME,
  EnvKey.RNACOS_PASSWORD,
  EnvKey.RNACOS_REQUEST_TIMEOUT_MS,
];

function withEnv(values: Partial<Record<EnvKey, string>>): () => void {
  const saved = new Map<string, string | undefined>();
  for (const key of MANAGED_KEYS) {
    saved.set(key, process.env[key]);
    Reflect.deleteProperty(process.env, key);
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  };
}

describe('createRuntimeConfigDocumentSource', () => {
  let restoreEnv: () => void = () => undefined;

  afterEach(() => {
    restoreEnv();
  });

  it('builds no source unless RNACOS_ENABLED is exactly "true"', () => {
    for (const flag of [undefined, 'false', 'TRUE', '1']) {
      restoreEnv = withEnv(
        flag === undefined ? {} : { [EnvKey.RNACOS_ENABLED]: flag },
      );
      expect(createRuntimeConfigDocumentSource()).toBeNull();
      restoreEnv();
    }
  });

  it('builds the rnacos adapter from the environment when enabled', async () => {
    restoreEnv = withEnv({
      [EnvKey.RNACOS_ENABLED]: 'true',
      [EnvKey.RNACOS_SERVER_ADDR]: '127.0.0.1:8848',
      [EnvKey.RNACOS_NAMESPACE]: 'lucent-dev',
      [EnvKey.RNACOS_USERNAME]: 'rnacos',
      [EnvKey.RNACOS_PASSWORD]: 'dev-password',
      [EnvKey.RNACOS_REQUEST_TIMEOUT_MS]: '250',
    });

    const source = createRuntimeConfigDocumentSource();

    expect(source).toBeInstanceOf(RnacosConfigSource);
    await expect(source?.close()).resolves.toBeUndefined();
  });

  it('leaves the native binding unloaded while disabled', () => {
    restoreEnv = withEnv({});
    const source = createRuntimeConfigDocumentSource();
    expect(source).toBeNull();
  });
});
