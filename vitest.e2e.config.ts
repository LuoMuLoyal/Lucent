import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      root: '.',
      include: ['test/**/*.e2e-spec.ts'],
      // E2E 测试串行执行，避免数据库竞争
      pool: 'forks',
      poolOptions: {
        forks: { singleFork: true },
      },
      // E2E 不收集覆盖率
      coverage: { enabled: false },
    },
  }),
);
