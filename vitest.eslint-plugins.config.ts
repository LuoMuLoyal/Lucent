import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    environment: 'node',
    include: ['eslint-plugins/**/*.spec.ts'],
    globals: true,
  },
});
