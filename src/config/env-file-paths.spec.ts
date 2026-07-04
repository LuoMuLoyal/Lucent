import { getDotenvLoadOrder, getEnvFilePaths } from './env-file-paths';

describe('env file path helpers', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (typeof originalNodeEnv === 'undefined') {
      delete process.env['NODE_ENV'];
      return;
    }

    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('returns ConfigModule env file paths with local file first', () => {
    process.env['NODE_ENV'] = 'test';

    expect(getEnvFilePaths()).toEqual(['.env.test.local', '.env.test']);
  });

  it('returns dotenv load order with base file first so local overrides last', () => {
    process.env['NODE_ENV'] = 'test';

    expect(getDotenvLoadOrder()).toEqual(['.env.test', '.env.test.local']);
  });
});
