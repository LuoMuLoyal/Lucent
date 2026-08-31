/**
 * Architecture dependency rules - docs governance plan Phase 3.
 *
 * All rules use severity 'warn' (observation period, does not fail the run).
 * Run: pnpm exec depcruise src --config .dependency-cruiser.cjs
 *
 * Cross-module rules use a capture group in `from` referenced as `$1` in `to`
 * (dependency-cruiser replaces group placeholders in `to` with matches from
 * `from.path`) to express "a different module" without hardcoding names.
 * node_modules patterns have a flat alternation branch for the pnpm
 * `.pnpm/<pkg>@<ver>/node_modules/<pkg>` realpath layout (nested quantifiers
 * are rejected by dependency-cruiser's safe-regex check).
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    /*
     * R1 - module cross-boundary imports must go through the target module's
     * public barrel (src/modules/<B>/index.ts). Same-module deep imports are
     * allowed; the target module's *.module.ts is also allowed (NestJS module
     * classes are imported directly from the .module.ts file per project
     * convention to avoid circular barrels).
     */
    {
      name: 'modules-cross-boundary-must-use-barrel',
      severity: 'warn',
      comment:
        'Cross-module imports (A != B) may only target src/modules/<B>/index.ts. ' +
        'Same-module deep imports and target *.module.ts files are exempt.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/(?!$1/)[^/]+/',
        pathNot: ['^src/modules/[^/]+/index\\.ts$', '^src/modules/[^/]+/[^/]+\\.module\\.ts$'],
      },
    },

    /*
     * R2 - cross-module imports may not reach into another module's
     * repositories/ or dto/ at all (overlaps R1 on purpose so severity can be
     * tuned independently later).
     */
    {
      name: 'modules-cross-boundary-repositories-dto-forbidden',
      severity: 'warn',
      comment:
        'Cross-module imports (A != B) may never target src/modules/<B>/(repositories|dto)/**.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/(?!$1/)[^/]+/(?:repositories|dto)/',
      },
    },

    /*
     * R3 - src/common is a leaf layer: it must not import anything from
     * src/modules.
     */
    {
      name: 'common-no-module-imports',
      severity: 'warn',
      comment: 'src/common/** must not import from src/modules/**.',
      from: { path: '^src/common/' },
      to: {
        path: '^src/modules/',
      },
    },

    /*
     * R4 - business modules must not touch low-level redis clients directly;
     * they go through the wrappers in src/common (redis.service, cache config,
     * queue). Package names reflect what package.json actually uses
     * (ioredis, keyv; there is no `redis` package in this repo).
     */
    {
      name: 'modules-no-direct-redis-clients',
      severity: 'warn',
      comment:
        'src/modules/** must not import ioredis or keyv directly ' +
        '(use the src/common redis/cache/queue wrappers).',
      from: { path: '^src/modules/' },
      to: {
        path:
          '^node_modules/(?:ioredis|keyv)/|^node_modules/\\.pnpm/[^/]+/node_modules/(?:ioredis|keyv)/',
      },
    },

    /*
     * R5 - controllers must not touch the prisma client directly; data access
     * goes through services/repositories. Covers both the @prisma/client
     * package and the in-repo src/prisma wrapper.
     */
    {
      name: 'controllers-no-direct-prisma',
      severity: 'warn',
      comment:
        '**/*.controller.ts must not import @prisma/client or src/prisma/**.',
      from: { path: '\\.controller\\.ts$' },
      to: {
        path:
          '^node_modules/@prisma/client/|^node_modules/\\.pnpm/[^/]+/node_modules/@prisma/client/|^src/prisma/',
      },
    },

    /*
     * Default circular-dependency check (kept at warn, per plan).
     */
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Default dependency-cruiser circular dependency check.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    /* keep node_modules edges (needed by R4/R5) but do not traverse into them */
    doNotFollow: { path: 'node_modules' },
    /* resolve TS path aliases (e.g. #generated/*) */
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
