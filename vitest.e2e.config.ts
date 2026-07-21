import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { resolve } from 'node:path';

// Standalone E2E test configuration — deliberately does NOT use `mergeConfig`
// with vitest.config.ts.  `mergeConfig` concatenates the `include` arrays,
// which would pull in all src unit-test spec files alongside the e2e suite,
// causing them to run in the same single fork.  The shared process state
// (module mocks, env mutations, etc.) from 245 unit test files can corrupt
// subsequent e2e `createTestApp()` calls.  Instead, the SWC plugin and
// `#generated` alias are duplicated here so the config is self-contained.
export default defineConfig({
  plugins: [
    // SWC 插件复用项目已有的 .swcrc 配置（decorators、legacy decorators 等）
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
  resolve: {
    alias: {
      '#generated': resolve(__dirname, 'generated'),
    },
  },
  test: {
    root: '.',
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    globals: true,
    clearMocks: true,
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
});
