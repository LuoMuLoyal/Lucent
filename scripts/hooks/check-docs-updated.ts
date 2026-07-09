// Pre-commit documentation check.
//
// Verifies that when source-code files (src/**/*.ts, excluding specs and
// generated) are staged, a documentation file (migration log under
// docs/02-logs/migration-log/ or any file under docs/00-current/) is
// also staged. Blocks the commit by default.
//
// Bypass with SKIP_DOC_CHECK=1 or git commit --no-verify.

const { execSync } = require('node:child_process');

// --- Config ---------------------------------------------------------------

const BYPASS_ENV = 'SKIP_DOC_CHECK';
const MIGRATION_LOG_DIR = 'docs/02-logs/migration-log';

/**
 * Patterns that identify "source code" files requiring a doc update.
 * Uses forward-slash paths (git always outputs forward slashes).
 */
const SOURCE_CODE_PATTERNS: RegExp[] = [/^src\/.*\.ts$/];

/** Patterns to exclude from the source-code check. */
const EXCLUDE_PATTERNS: RegExp[] = [
  /\.spec\.ts$/,
  /\.e2e-spec\.ts$/,
  /^src\/generated\//,
  /^generated\//,
  /^test\//,
];

// --- Helpers --------------------------------------------------------------

function run(cmd: string): string {
  return execSync(cmd, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function getStagedFiles(): string[] {
  const output = run('git diff --cached --name-only --diff-filter=ACMR');
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function isSourceCode(filePath: string): boolean {
  if (EXCLUDE_PATTERNS.some((p) => p.test(filePath))) return false;
  return SOURCE_CODE_PATTERNS.some((p) => p.test(filePath));
}

function getTodayLogPath(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${MIGRATION_LOG_DIR}/${yyyy}-${mm}-${dd}.md`;
}

// --- Main -----------------------------------------------------------------

function main(): void {
  if (process.env[BYPASS_ENV] === '1') {
    console.log(`[doc-check] Skipped (${BYPASS_ENV}=1)`);
    return;
  }

  const stagedFiles = getStagedFiles();

  // If only docs/ config/ scripts/ changes are staged, no check needed.
  const sourceCodeFiles = stagedFiles.filter(isSourceCode);
  if (sourceCodeFiles.length === 0) {
    return; // No source-code changes — nothing to check.
  }

  const todayLogPath = getTodayLogPath();

  // Check whether any migration log or current-state doc is staged.
  const hasMigrationLog = stagedFiles.some(
    (f) => f === todayLogPath || f.startsWith(MIGRATION_LOG_DIR + '/'),
  );

  const hasCurrentState = stagedFiles.some((f) =>
    f.startsWith('docs/00-current/'),
  );

  if (hasMigrationLog || hasCurrentState) {
    return; // Doc update detected — pass.
  }

  // Build helpful message.
  const fileCount = sourceCodeFiles.length;
  const filePreview = sourceCodeFiles.slice(0, 5).join('\n  ');
  const moreCount = fileCount > 5 ? `\n  ... and ${fileCount - 5} more` : '';

  console.error(`
┌─────────────────────────────────────────────────────────────────┐
│  ⚠  Documentation Check Failed                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ${fileCount} source-code file(s) staged but no doc update detected:
│  ${filePreview}${moreCount}
│                                                                 │
│  Per workspace rules (AGENTS.md), code changes must be          │
│  accompanied by a migration-log entry:                          │
│                                                                 │
│    ${todayLogPath}
│                                                                 │
│  (or any file under docs/00-current/ or docs/02-logs/)          │
│                                                                 │
│  To bypass:  SKIP_DOC_CHECK=1 git commit ...                   │
│             or  git commit --no-verify                          │
└─────────────────────────────────────────────────────────────────┘
`);

  process.exit(1);
}

main();
