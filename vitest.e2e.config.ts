import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      root: '.',
      include: ['test/**/*.e2e-spec.ts'],
      // E2E 测试串行执行，避免数据库竞争（等价于 Jest --runInBand）
      fileParallelism: false,
      pool: 'forks',
      singleFork: true,
      // Fastify 插件注册比 Express 慢，需要更长的超时
      hookTimeout: 30_000,
      testTimeout: 15_000,
      // E2E 不收集覆盖率
      coverage: { enabled: false },
    },
  }),
);
