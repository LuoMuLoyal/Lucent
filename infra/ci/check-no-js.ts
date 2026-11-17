/**
 * Blocks commits that would add or modify a JavaScript file.
 *
 * The repository is TypeScript-only: source, scripts, configs. A `.js` file that
 * slips in is never load-bearing — it is either a generated artifact that should
 * be ignored, or a leftover that should have been TypeScript. Both are cheap to
 * fix at commit time and expensive to find later, so this gate stops them at the
 * door instead of relying on review.
 *
 * Runs directly under Node 26, which strips types without a build step — the same
 * reason the other scripts in `infra/ci` are plain `.ts` rather than `.mjs`.
 *
 * Usage: node infra/ci/check-no-js.ts            (all tracked files)
 *        node infra/ci/check-no-js.ts --staged   (only staged changes)
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const STAGED = process.argv.includes('--staged');

const JS_PATTERN = /\.(js|jsx|cjs|mjs)$/i;

/**
 * Paths that are deliberately JavaScript.
 *
 * Empty by design: the two former entries (`.dependency-cruiser.cjs` and
 * `admin/eslint.config.js`) were converted to JSON and TypeScript respectively
 * once their toolchains proved they could load them. If a real exception ever
 * appears, justify it here with a comment naming the tool that cannot load
 * anything else — a growing list means the rule is being negotiated away rather
 * than applied.
 */
const ALLOWED: readonly string[] = [];

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

const files = STAGED
  ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
      .split('\n')
      .filter(Boolean)
  : git(['ls-files']).split('\n').filter(Boolean);

const offenders = files
  .filter((f) => JS_PATTERN.test(f))
  .filter((f) => !ALLOWED.includes(f))
  // Build outputs, dependencies and generated code are never committed, so any
  // hit here means the ignore rules are wrong — report it as such rather than
  // pretending the file itself is the problem.
  .filter((f) => !/node_modules|(^|\/)dist\/|\.turbo\/|generated\//.test(f));

if (offenders.length > 0) {
  console.error(
    `Refusing ${STAGED ? 'commit' : 'check'}: ${offenders.length} JavaScript file(s) found.`,
  );
  for (const f of offenders) {
    console.error(`  ${f}`);
  }
  console.error(
    '\nThis repository is TypeScript-only. Pick one:',
    '\n  - convert it to .ts (Node 26 runs TypeScript directly; configs included)',
    '\n  - delete it if it is a one-off or generated artifact',
    '\n  - add it to .gitignore if it is build output',
  );
  process.exit(1);
}

console.log(
  `No JavaScript files ${STAGED ? 'staged' : 'tracked'} (${files.length} file(s) checked)`,
);
