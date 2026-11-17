import { defineConfig } from 'vitest/config';

// Tests the ESLint plugin suite that enforces this app's error-handling rules.
// Both the runner and the plugin sources live in this package, so `vitest` and
// `acorn` resolve normally — they are declared here, not at the workspace root.
export default defineConfig({
  test: {
    root: '.',
    environment: 'node',
    include: ['eslint-plugins/**/*.spec.ts'],
    globals: true,
  },
});
