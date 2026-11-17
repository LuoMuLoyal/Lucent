#!/usr/bin/env node
/**
 * Restores `apps/monolith/package.json` scripts to their pre-move form.
 *
 * Rationale: every lint/arch/format config now lives **inside this app**
 * (`.oxlintrc.json`, `eslint.config.ts`, `.prettierrc`, `.dependency-cruiser.cjs`).
 * Configs describe this package's code, and this app is the only thing that runs
 * them, so they travel with it rather than sitting at the workspace root.
 *
 * That makes the tool invocations identical to before the move: same relative
 * config discovery, same globs, same cwd. The move becomes a pure directory
 * rename from the tooling's point of view — no `../../` reach-outs, no duplicated
 * config, no path rewriting.
 *
 * The only edits here are the two that *cannot* be relative-fixed: dropping
 * `cross-env` wrappers that pointed at a root-level vitest config.
 *
 * Usage:
 *   node scripts/dev/reset-scripts-for-app-local-configs.mjs [--write]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = resolve(HERE, '..', '..', 'package.json');
const WRITE = process.argv.includes('--write');

const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));

/** The original globs; `src`/`test`/`scripts` all exist under this app now. */
const APP_SOURCES = '"{src,test}/**/*.ts"';
const PRETTIER_GLOBS =
  '"src/**/*.ts" "test/**/*.ts" "scripts/**/*.ts" "*.{ts,json,yml,yaml,md}"';

const replacements = [
  ['lint', `oxlint src test --fix && eslint ${APP_SOURCES} --ignore-pattern "generated/**" --fix`],
  [
    'lint:check',
    `oxlint src test && eslint ${APP_SOURCES} --ignore-pattern "generated/**" --max-warnings=0`,
  ],
  ['lint:oxlint', 'oxlint src test'],
  ['lint:oxlint:fix', 'oxlint src test --fix'],
  [
    'lint:eslint',
    `eslint ${APP_SOURCES} --ignore-pattern "generated/**" --max-warnings=0`,
  ],
  [
    'lint:eslint:fix',
    `eslint ${APP_SOURCES} --ignore-pattern "generated/**" --fix`,
  ],
  ['format', `prettier --write ${PRETTIER_GLOBS}`],
  ['format:check', `prettier --check ${PRETTIER_GLOBS}`],
  ['test:eslint-plugins', 'cross-env NODE_ENV=test vitest run --config ./vitest.eslint-plugins.config.ts'],
  [
    'test:eslint-plugins:ci',
    'cross-env NODE_ENV=test vitest run --config ./vitest.eslint-plugins.config.ts --reporter=dot',
  ],
];

const changes = [];
for (const [name, next] of replacements) {
  const current = pkg.scripts[name];
  if (current == null || current === next) continue;
  changes.push({ name, from: current, to: next });
  if (WRITE) pkg.scripts[name] = next;
}

for (const change of changes) {
  console.log(`${WRITE ? 'SET' : 'WOULD SET'} ${change.name}`);
  console.log(`    was: ${change.from}`);
  console.log(`    now: ${change.to}`);
}

if (changes.length === 0) {
  console.log('Scripts already match the app-local layout.');
} else if (WRITE) {
  writeFileSync(PACKAGE_JSON, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${PACKAGE_JSON}`);
} else {
  console.log(`\n${changes.length} script(s) would change. Re-run with --write.`);
}
