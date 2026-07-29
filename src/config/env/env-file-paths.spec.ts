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

  it('handles undefined NODE_ENV by defaulting to development', () => {
    delete process.env['NODE_ENV'];

    expect(getEnvFilePaths()).toEqual([
      '.env.development.local',
      '.env.development',
    ]);
    expect(getDotenvLoadOrder()).toEqual([
      '.env.development',
      '.env.development.local',
    ]);
  });

  it('returns development env files when NODE_ENV is development', () => {
    process.env['NODE_ENV'] = 'development';

    expect(getEnvFilePaths()).toEqual([
      '.env.development.local',
      '.env.development',
    ]);
    expect(getDotenvLoadOrder()).toEqual([
      '.env.development',
      '.env.development.local',
    ]);
  });

  it('returns production env files when NODE_ENV is production', () => {
    process.env['NODE_ENV'] = 'production';

    expect(getEnvFilePaths()).toEqual([
      '.env.production.local',
      '.env.production',
    ]);
    expect(getDotenvLoadOrder()).toEqual([
      '.env.production',
      '.env.production.local',
    ]);
  });
});
