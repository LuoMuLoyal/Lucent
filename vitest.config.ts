import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { resolve } from 'node:path';

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
    root: 'src',
    environment: 'node',
    pool: 'forks',
    include: ['**/*.spec.ts'],
    globals: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['**/*.{ts,js}'],
      exclude: [
        'node_modules/',
        'src/generated/',
        '**/*.spec.ts',
        '**/*.e2e-spec.ts',
      ],
      reporter: ['text', 'lcov'],
      reportsDirectory: '../coverage',
      thresholds: {
        branches: 74,
        functions: 85,
        lines: 84,
        statements: 84,
      },
    },
  },
});
