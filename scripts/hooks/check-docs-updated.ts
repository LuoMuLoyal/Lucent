// Documentation coverage check for Lucent.
//
// Reads `docs/doc-map.yaml` and maps staged/changed code files to required
// documentation updates.
//
// Modes:
// - Blocking (default, used by pre-commit hook):
//   Code files staged but NO docs/ files staged → exit(1).
//   Per-rule missing-doc warnings are printed but do not independently block.
// - Warning-only (`--warning-only`):
//   Prints the per-rule report (which docs each touched code area expects)
//   without blocking. Use for daily checks or manual review.
//
// Bypass: SKIP_DOC_CHECK=1 or `git commit --no-verify`.
//
// Usage:
//   node scripts/hooks/check-docs-updated.ts                 # blocking, staged
//   node scripts/hooks/check-docs-updated.ts --warning-only  # non-blocking, working tree
//   node scripts/hooks/check-docs-updated.ts --staged        # blocking, staged only

const { execSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

// --- Config ---------------------------------------------------------------

const BYPASS_ENV = 'SKIP_DOC_CHECK';
const DOC_MAP_PATH = 'docs/doc-map.yaml';
const MIGRATION_LOG_GLOB = 'docs/02-logs/migration-log/*.md';

/** Max deletion lines allowed in a staged migration-log file before blocking. */
const MIGRATION_LOG_MAX_DELETIONS = 5;

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

// --- Types ---------------------------------------------------------------

interface DocCoverageRule {
  name: string;
  codePatterns: string[];
  requiredDocs: string[];
}

interface DocCoverageMatch {
  ruleName: string;
  touchedCodeFiles: string[];
  missingDocs: string[];
}

// --- YAML parsing (minimal, tailored to doc-map.yaml structure) ----------

/**
 * Parses a minimal subset of YAML sufficient for `doc-map.yaml`.
 *
 * Supported structure:
 *   rules:
 *     - name: <string>
 *       code:
 *         - <pattern>
 *       docs_required:
 *         - <pattern>
 *
 * Comments (lines starting with `#`) and blank lines are ignored.
 */
function parseDocMapYaml(source: string): DocCoverageRule[] {
  const rules: DocCoverageRule[] = [];
  let currentName: string | null = null;
  let currentCode: string[] | null = null;
  let currentDocs: string[] | null = null;
  let currentSection: 'code' | 'docs_required' | null = null;
  let inRules = false;

  function commitRule(): void {
    if (currentName !== null) {
      rules.push({
        name: currentName,
        codePatterns: currentCode ?? [],
        requiredDocs: currentDocs ?? [],
      });
    }
  }

  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('#')) continue;

    if (trimmed === 'rules:') {
      inRules = true;
      continue;
    }

    if (!inRules) continue;

    if (trimmed.startsWith('- name:')) {
      commitRule();
      currentName = trimmed.substring('- name:'.length).trim();
      currentCode = [];
      currentDocs = [];
      currentSection = null;
      continue;
    }

    if (trimmed === 'code:') {
      currentSection = 'code';
      continue;
    }

    if (trimmed === 'docs_required:') {
      currentSection = 'docs_required';
      continue;
    }

    if (trimmed.startsWith('- ')) {
      const value = trimmed.substring(2).trim();
      if (currentSection === 'code') {
        currentCode?.push(value);
      } else if (currentSection === 'docs_required') {
        currentDocs?.push(value);
      } else {
        throw new Error(`Unexpected list item outside a rule section: ${line}`);
      }
      continue;
    }

    throw new Error(`Unsupported doc-map.yaml line: ${line}`);
  }

  commitRule();
  return rules;
}

function loadDocMap(repoRoot: string): DocCoverageRule[] {
  const configPath = resolve(repoRoot, DOC_MAP_PATH);
  if (!existsSync(configPath)) {
    throw new Error(`Doc coverage config not found: ${configPath}`);
  }
  return parseDocMapYaml(readFileSync(configPath, 'utf-8'));
}

// --- Glob matching --------------------------------------------------------

/**
 * Converts a glob pattern to a RegExp.
 * `*` matches a single path segment (no `/`).
 * `**` matches multiple path segments.
 */
function globToRegExp(pattern: string): RegExp {
  const buffer: string[] = ['^'];
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (i + 1 < pattern.length && pattern[i + 1] === '*') {
        buffer.push('.*');
        i++;
      } else {
        buffer.push('[^/]*');
      }
      continue;
    }
    if ('\\.[]{}()+-?^$|'.includes(char)) {
      buffer.push(`\\${char}`);
    } else {
      buffer.push(char);
    }
  }
  buffer.push('$');
  return new RegExp(buffer.join(''));
}

function matchesPattern(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return globToRegExp(pattern).test(normalized);
}

// --- Git helpers ----------------------------------------------------------

function run(cmd: string): string {
  return execSync(cmd, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function getChangedFiles(stagedOnly: boolean): string[] {
  const diffCmd = stagedOnly
    ? 'git diff --cached --name-only --diff-filter=ACMR'
    : 'git diff --name-only --diff-filter=ACMR';
  const changed = run(diffCmd)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (stagedOnly) return changed;

  // Include untracked files in working-tree mode.
  const untracked = run('git ls-files --others --exclude-standard')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return [...new Set([...changed, ...untracked])];
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
  return `docs/02-logs/migration-log/${yyyy}-${mm}-${dd}.md`;
}

// --- Report building ------------------------------------------------------

interface Report {
  matchedRules: DocCoverageMatch[];
  hasWarnings: boolean;
}

function buildReport(
  rules: DocCoverageRule[],
  changedFiles: string[],
  documentedFiles: string[],
): Report {
  const normalizedChanged = changedFiles.map((f) => f.replace(/\\/g, '/'));
  const normalizedDocs = documentedFiles.map((f) => f.replace(/\\/g, '/'));
  const matches: DocCoverageMatch[] = [];

  for (const rule of rules) {
    const touchedCodeFiles = normalizedChanged.filter((file) =>
      rule.codePatterns.some((pattern) => matchesPattern(file, pattern)),
    );
    if (touchedCodeFiles.length === 0) continue;

    const missingDocs = rule.requiredDocs.filter(
      (docPattern) =>
        !normalizedDocs.some((docFile) => matchesPattern(docFile, docPattern)),
    );

    matches.push({
      ruleName: rule.name,
      touchedCodeFiles,
      missingDocs,
    });
  }

  return {
    matchedRules: matches,
    hasWarnings: matches.some((m) => m.missingDocs.length > 0),
  };
}

function renderReport(report: Report): string {
  if (report.matchedRules.length === 0) {
    return 'Documentation coverage: no mapped code changes detected.';
  }

  if (!report.hasWarnings) {
    return 'Documentation coverage: all mapped doc targets were updated.';
  }

  const buffer: string[] = ['Documentation coverage warnings:\n'];
  for (const match of report.matchedRules.filter(
    (m) => m.missingDocs.length > 0,
  )) {
    buffer.push(`- Rule: ${match.ruleName}`);
    buffer.push(`  Code changes: ${match.touchedCodeFiles.join(', ')}`);
    buffer.push(`  Review/update docs: ${match.missingDocs.join(', ')}`);
  }
  buffer.push('This is warning-only and does not block the workflow.');
  return buffer.join('\n');
}

// --- Migration log overwrite detection -----------------------------------

/**
 * Checks staged migration-log files for excessive deletions.
 *
 * Migration logs must be **appended** to, not overwritten. If a staged
 * diff for a migration-log file contains more than
 * `MIGRATION_LOG_MAX_DELETIONS` deleted lines, the commit is blocked.
 *
 * This prevents accidental data loss when multiple commits touch the
 * same date's log file.
 */
function checkMigrationLogOverwrite(): void {
  const stagedModified = run('git diff --cached --name-only --diff-filter=M')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const migrationLogPattern = /^docs\/02-logs\/migration-log\/.+\.md$/;
  const logFiles = stagedModified.filter((f) =>
    migrationLogPattern.test(f.replace(/\\/g, '/')),
  );

  for (const file of logFiles) {
    const diff = run(`git diff --cached -- ${file}`);
    const deletionCount = diff
      .split('\n')
      .filter((line) => line.startsWith('-') && !line.startsWith('---')).length;

    if (deletionCount > MIGRATION_LOG_MAX_DELETIONS) {
      console.error(`
\u2502  \u26a0  Migration Log Overwrite Detected                                   \u2502
\u2502                                                                 \u2502
\u2502  ${file}                                                 \u2502
\u2502  has ${deletionCount} deleted lines in staged diff (max ${MIGRATION_LOG_MAX_DELETIONS}).        \u2502
\u2502                                                                 \u2502
\u2502  Migration logs must be appended to, not overwritten.            \u2502
\u2502  If restructure is needed, keep deletions \u2264 ${MIGRATION_LOG_MAX_DELETIONS}.               \u2502
\u2502                                                                 \u2502
\u2502  To bypass:  SKIP_DOC_CHECK=1 git commit ...                   \u2502
\u2502             or  git commit --no-verify                          \u2502
`);
      process.exit(1);
    }
  }
}

// --- Args parsing ---------------------------------------------------------

interface ParsedArgs {
  stagedOnly: boolean;
  warningOnly: boolean;
  showHelp: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  let stagedOnly = false;
  let warningOnly = false;
  let showHelp = false;

  for (const arg of args) {
    if (arg === '--staged') {
      stagedOnly = true;
    } else if (arg === '--warning-only') {
      warningOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return { stagedOnly, warningOnly, showHelp };
}

const USAGE = `
Usage: node scripts/hooks/check-docs-updated.ts [options]

Reads docs/doc-map.yaml and checks whether code changes are accompanied
by the expected documentation updates.

Options:
  --staged            Read staged changes instead of the working tree.
  --warning-only      Do not block; just print the per-rule report.
  --help              Show this help text.

Environment:
  SKIP_DOC_CHECK=1    Bypass the blocking check (ignored with --warning-only).
`;

// --- Main -----------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp) {
    console.log(USAGE);
    return;
  }

  // Bypass (only meaningful in blocking mode).
  if (!args.warningOnly && process.env[BYPASS_ENV] === '1') {
    console.log(`[doc-check] Skipped (${BYPASS_ENV}=1)`);
    return;
  }

  // Check migration-log overwrite before the doc-coverage check.
  if (!args.warningOnly) {
    checkMigrationLogOverwrite();
  }

  const repoRoot = resolve(__dirname, '..', '..');
  const rules = loadDocMap(repoRoot);
  const changedFiles = getChangedFiles(args.stagedOnly);

  if (changedFiles.length === 0) {
    console.log('Documentation coverage: no changed files detected.');
    return;
  }

  const documentedFiles = changedFiles.filter((f) =>
    f.replace(/\\/g, '/').startsWith('docs/'),
  );

  const report = buildReport(rules, changedFiles, documentedFiles);
  console.log(renderReport(report));

  // Default (blocking) mode: block the commit if code files are staged/changed
  // but NO documentation files are included.
  if (!args.warningOnly && report.matchedRules.length > 0) {
    const hasCodeChanges = report.matchedRules.some(
      (m) => m.touchedCodeFiles.length > 0,
    );
    if (hasCodeChanges && documentedFiles.length === 0) {
      const sourceCodeFiles = changedFiles.filter(isSourceCode);
      const fileCount = sourceCodeFiles.length;
      const filePreview = sourceCodeFiles.slice(0, 5).join('\n  ');
      const moreCount =
        fileCount > 5 ? `\n  ... and ${fileCount - 5} more` : '';
      const todayLogPath = getTodayLogPath();

      console.error(`
┌─────────────────────────────────────────────────────────────────┐
│  ⚠  Documentation Check Failed                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ${fileCount} source-code file(s) staged but no doc update detected:
│  ${filePreview}${moreCount}
│                                                                 │
│  Run \`pnpm docs:check\` to see which docs need updating,        │
│  or append a migration-log entry:                               │
│                                                                 │
│    ${todayLogPath}                                              │
│                                                                 │
│  (or any file under docs/00-current/ or docs/02-logs/)          │
│                                                                 │
│  To bypass:  SKIP_DOC_CHECK=1 git commit ...                   │
│             or  git commit --no-verify                          │
└─────────────────────────────────────────────────────────────────┘
`);
      process.exit(1);
    }
  }
}

main();
