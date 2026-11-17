/**
 * Checks that every `COPY <src>` in the Dockerfile points at a path that exists.
 *
 * Why: a broken COPY source is invisible until an actual `docker build` runs, and
 * that is exactly what happened to the monorepo move — the build failed with
 * `"/src": not found` only in CI. Docker cannot be run in every environment (no
 * registry access, no daemon), but the copy sources can be verified statically,
 * which catches the whole class of breakage this check exists for.
 *
 * Scope: only sources that come from the build context. `COPY --from=<stage>`
 * copies from another stage and must be skipped.
 *
 * Usage: node infra/ci/check-dockerfile-paths.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DOCKERFILE = resolve(ROOT, 'Dockerfile');

const lines = readFileSync(DOCKERFILE, 'utf8').split(/\r?\n/);
const missing: { line: number; source: string }[] = [];
const checked: string[] = [];

for (let i = 0; i < lines.length; i += 1) {
  const line = (lines[i] ?? '').trim();
  if (!line.startsWith('COPY ')) continue;

  // Everything after COPY is flags + sources + dest. A `--from=` flag means the
  // sources live in another stage, not in the build context.
  const tokens = line.slice(5).trim().split(/\s+/);
  if (tokens.some((t) => t.startsWith('--from='))) continue;

  const positional = tokens.filter((t) => !t.startsWith('--'));
  if (positional.length < 2) continue;

  const sources = positional.slice(0, -1);
  for (const source of sources) {
    const normalized = source.replace(/^\.\//, '');
    if (existsSync(resolve(ROOT, normalized))) {
      checked.push(normalized);
    } else {
      missing.push({ line: i + 1, source: normalized });
    }
  }
}

if (missing.length > 0) {
  console.error(
    `Dockerfile references ${missing.length} path(s) that do not exist in the build context:`,
  );
  for (const entry of missing) {
    console.error(`  line ${entry.line}: ${entry.source}`);
  }
  console.error(
    '\nThis is what breaks `docker build` after a directory move. Fix the path',
    'or delete the COPY if the file is gone.',
  );
  process.exit(1);
}

console.log(
  `Dockerfile COPY sources OK (${checked.length} context paths, ${new Set(checked).size} unique)`,
);
