/**
 * Locks the `ddd-domain-purity` rule's scope (ADR-0024, D1).
 *
 * The rule exempts `import type` / `export type` edges out of `domain/` while
 * still forbidding value imports. That exemption is a deliberate narrowing, and
 * a narrowing that silently widened itself (e.g. dependency-cruiser reporting
 * the edge type differently after an upgrade) would let framework code back in
 * without any test noticing.
 *
 * This spec therefore probes both directions with a throwaway domain file:
 *
 * - a `import type` from `common/` produces no `ddd-domain-purity` violation;
 * - a value `import` from `common/` still produces one, carrying a value
 *   dependency type from dependency-cruiser (`import`, not `type-only`).
 *
 * It runs dependency-cruiser directly (not through `arch:check`) so the
 * assertion is on the rule itself, not on the baseline being unchanged.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROBE_DIR = join(
  REPO_ROOT,
  'src',
  'modules',
  'user-settings',
  'domain',
  'settings',
);
const PROBE_FILE = join(PROBE_DIR, '__domain-purity-probe.ts');

interface DepcruiseViolation {
  rule: { name: string };
  from: string;
  to: string;
  dependencyTypes?: string[];
}

function cruisDomain(): DepcruiseViolation[] {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'depcruise',
      join('src', 'modules', 'user-settings', 'domain'),
      '--config',
      '.dependency-cruiser.cjs',
      '--output-type',
      'json',
    ],
    { cwd: REPO_ROOT, shell: true, encoding: 'utf-8' },
  );
  const raw = result.stdout.length > 0 ? result.stdout : result.stderr;
  const parsed = JSON.parse(raw) as {
    violations?: DepcruiseViolation[];
    summary?: { violations?: DepcruiseViolation[] };
  };
  return parsed.violations ?? parsed.summary?.violations ?? [];
}

function purityViolationsOnProbe(): DepcruiseViolation[] {
  return cruisDomain().filter(
    (violation) =>
      violation.rule.name === 'ddd-domain-purity' &&
      violation.from.includes('__domain-purity-probe'),
  );
}

describe('ddd-domain-purity scope', () => {
  beforeEach(() => {
    mkdirSync(PROBE_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(PROBE_FILE, { force: true });
  });

  it('still reports a value import out of the domain tree', () => {
    writeFileSync(
      PROBE_FILE,
      [
        "import { now } from '../../../../common/index.js';",
        'export const probe = now;',
        '',
      ].join('\n'),
      'utf-8',
    );

    const violations = purityViolationsOnProbe();

    expect(violations).toHaveLength(1);
    expect(violations[0]?.dependencyTypes).not.toContain('type-only');
  });

  it('exempts a type-only import out of the domain tree', () => {
    writeFileSync(
      PROBE_FILE,
      [
        "import type { DomainFailure } from '../../../../common/result/index.js';",
        'export type Probe = DomainFailure;',
        '',
      ].join('\n'),
      'utf-8',
    );

    expect(purityViolationsOnProbe()).toEqual([]);
  });
});
