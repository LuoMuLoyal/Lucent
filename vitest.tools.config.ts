import { defineConfig } from 'vitest/config';

// Repo helper scripts (scripts/) are not part of the Nest app test surface.
// `pnpm test:tools` runs their specs with repo root as the test root.
export default defineConfig({
  test: {
    root: '.',
    environment: 'node',
    pool: 'forks',
    include: ['scripts/**/*.spec.ts'],
    globals: true,
    clearMocks: true,
  },
});
