// Documentation coverage check for Lucent (CLI entry).
//
// Reads `docs/doc-map.yaml` and maps staged/changed code files to required
// documentation updates. Pure logic lives in ./doc-coverage-lib (testable).
//
// Modes:
// - Blocking (default, pre-commit): code staged but NO docs/ staged → exit(1).
// - Warning-only (--warning-only): print per-rule report without blocking.
// - Verify (--verify): check doc-map references, migration-log plan/spec
//   references, single-H1 structure, front-matter metadata (missing / stale
//   `updated` / `status: stale`), stale active docs, unreferenced docs, and
//   module-dir doc-map coverage. `status: frozen` docs are exempt from the
//   freshness checks. Bypass: SKIP_DOC_CHECK=1 or `git commit --no-verify`.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BYPASS_ENV,
  checkMigrationLogOverwrite,
  collectVerifyProblems,
  findDocsMissingFrontMatter,
  findStaleStatusDocs,
  findUncoveredModuleDirs,
  findUnreferencedActiveDocs,
  getStaleByFrontMatter,
  getStaleDocs,
  getTodayDate,
  getTodayLogPath,
  isActiveDoc,
  loadDocMap,
  buildReport,
  renderReport,
  MIGRATION_LOG_DIR,
  MIGRATION_LOG_DIR_LEGACY,
  STALE_DOC_THRESHOLD_DAYS,
  withoutFrozenDocs,
} from './doc-coverage-lib.ts';

const SOURCE_CODE_PATTERNS: RegExp[] = [/^src\/.*\.ts$/];
const EXCLUDE_PATTERNS: RegExp[] = [
  /\.spec\.ts$/,
  /\.e2e-spec\.ts$/,
  /^src\/generated\//,
  /^generated\//,
  /^test\//,
];

function run(cmd: string, cwd?: string): string {
  return execSync(cmd, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd,
  });
}

/** Resolve the git worktree root; fall back to process.cwd() outside a repo. */
function resolveRepoRoot(): string {
  try {
    const top = run('git rev-parse --show-toplevel').trim();
    return top || process.cwd();
  } catch {
    return process.cwd();
  }
}

function getChangedFiles(stagedOnly: boolean, cwd: string): string[] {
  const diffCmd = stagedOnly
    ? 'git diff --cached --name-only --diff-filter=ACMR'
    : 'git diff --name-only --diff-filter=ACMR';
  const changed = run(diffCmd, cwd)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (stagedOnly) return changed;
  const untracked = run('git ls-files --others --exclude-standard', cwd)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return [...new Set([...changed, ...untracked])];
}

function isSourceCode(filePath: string): boolean {
  if (EXCLUDE_PATTERNS.some((p) => p.test(filePath))) return false;
  return SOURCE_CODE_PATTERNS.some((p) => p.test(filePath));
}

// --- Verify helpers ----------------------------------------------------
function walkMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdownFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full.replace(/\\/g, '/'));
  }
  return out;
}

function collectAvailableDocs(repoRoot: string): string[] {
  const docsDir = resolve(repoRoot, 'docs');
  if (!existsSync(docsDir)) return [];
  const docsBase = resolve(repoRoot, 'docs').replace(/\\/g, '/');
  return walkMarkdownFiles(docsDir).map((f) =>
    f.replace(docsBase + '/', 'docs/'),
  );
}

/**
 * Docs surface outside `docs/`: module READMEs (code-adjacent module intent)
 * and the plans ledger. Used so doc-map rules may reference them without the
 * orphan check falsely reporting them as missing.
 */
function collectRepoSurfaceDocs(repoRoot: string): string[] {
  const out: string[] = [];
  const pushRelative = (full: string) =>
    out.push(full.slice(repoRoot.length + 1).replace(/\\/g, '/'));
  const plansDir = resolve(repoRoot, 'plans');
  if (existsSync(plansDir)) {
    for (const f of readdirSync(plansDir)) {
      if (f.endsWith('.md')) pushRelative(join(plansDir, f));
    }
  }
  const modulesDir = resolve(repoRoot, 'src', 'modules');
  if (existsSync(modulesDir)) {
    for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const readme = join(modulesDir, entry.name, 'README.md');
      if (existsSync(readme)) pushRelative(readme);
    }
  }
  const commonReadme = resolve(repoRoot, 'src', 'common', 'README.md');
  if (existsSync(commonReadme)) pushRelative(commonReadme);
  return out;
}

/** Collect migration-log entries from both the new and the legacy dir. */
function collectLogFiles(repoRoot: string): string[] {
  const files: string[] = [];
  for (const dir of [MIGRATION_LOG_DIR, MIGRATION_LOG_DIR_LEGACY]) {
    const logDir = resolve(repoRoot, ...dir.split('/'));
    if (!existsSync(logDir)) continue;
    files.push(
      ...readdirSync(logDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => `${dir}/${f}`),
    );
  }
  return files;
}

function getLastModifiedMap(
  repoRoot: string,
  files: string[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of files) {
    try {
      const d = run(`git log -1 --format=%cs -- ${f}`, repoRoot).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) map[f] = d;
    } catch {
      // untracked or not in git — skip
    }
  }
  return map;
}

function runVerify(repoRoot: string): void {
  const rules = loadDocMap(repoRoot);
  const availableDocs = collectAvailableDocs(repoRoot);
  const logFiles = collectLogFiles(repoRoot);
  // Authoring-time semantics apply to today's log wherever it lives
  // (new dir preferred; falls back to the legacy dir during transition).
  const legacyToday = `${MIGRATION_LOG_DIR_LEGACY}/${getTodayDate()}.md`;
  const canonicalToday = getTodayLogPath();
  const todayLogPath = logFiles.includes(canonicalToday)
    ? canonicalToday
    : legacyToday;
  const problems = collectVerifyProblems(
    repoRoot,
    rules,
    [...availableDocs, ...collectRepoSurfaceDocs(repoRoot)],
    logFiles,
    todayLogPath,
  );

  const activeDocs = availableDocs.filter(isActiveDoc);
  const contentByPath: Record<string, string> = {};
  for (const doc of activeDocs) {
    const full = resolve(repoRoot, doc);
    if (existsSync(full)) contentByPath[doc] = readFileSync(full, 'utf-8');
  }
  const lastModified = getLastModifiedMap(repoRoot, activeDocs);
  const today = getTodayDate();
  problems.push(
    ...findDocsMissingFrontMatter(activeDocs, contentByPath).map(
      (p) =>
        `${p}: missing/incomplete front-matter (need status / owner / quadrant / updated)`,
    ),
    ...getStaleByFrontMatter(activeDocs, contentByPath, today).map(
      (p) =>
        `${p}: stale (front-matter updated >${STALE_DOC_THRESHOLD_DAYS}d — review or archive)`,
    ),
    ...findStaleStatusDocs(activeDocs, contentByPath).map(
      (p) => `${p}: status=stale but not archived — move to docs/archive/`,
    ),
  );
  // Frozen docs are exempt from freshness checks; everything else is judged
  // by both front-matter `updated` and last git modification.
  const unfrozenActiveDocs = withoutFrozenDocs(activeDocs, contentByPath);
  problems.push(
    ...getStaleDocs(unfrozenActiveDocs, lastModified, today).map(
      (p) =>
        `${p}: stale (>${STALE_DOC_THRESHOLD_DAYS}d without update — review or archive)`,
    ),
  );
  problems.push(
    ...findUnreferencedActiveDocs(rules, activeDocs).map(
      (p) => `${p}: unreferenced by doc-map — consider archiving`,
    ),
  );
  // Every directory under src/modules/* must be matched by at least one
  // doc-map rule's `code` glob (or a documented exemption) so new modules
  // cannot land without documentation governance.
  const modulesDir = resolve(repoRoot, 'src', 'modules');
  if (existsSync(modulesDir)) {
    const moduleDirs = readdirSync(modulesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    problems.push(
      ...findUncoveredModuleDirs(rules, moduleDirs).map(
        (dir) =>
          `${dir}: module dir not covered by any doc-map rule — add a rule or a documented exemption`,
      ),
    );
  }

  if (problems.length > 0) {
    console.error(
      'Doc verification failed:\n' + problems.map((p) => `- ${p}`).join('\n'),
    );
    process.exit(1);
  }
  console.log(
    'Doc verification passed (doc-map references, H1 structure, front-matter, freshness, readership, module coverage).',
  );
}

// --- Args --------------------------------------------------------------
interface ParsedArgs {
  stagedOnly: boolean;
  warningOnly: boolean;
  verify: boolean;
  showHelp: boolean;
}
function parseArgs(args: string[]): ParsedArgs {
  let stagedOnly = false,
    warningOnly = false,
    verify = false,
    showHelp = false;
  for (const arg of args) {
    if (arg === '--staged') stagedOnly = true;
    else if (arg === '--warning-only') warningOnly = true;
    else if (arg === '--verify') verify = true;
    else if (arg === '--help' || arg === '-h') showHelp = true;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return { stagedOnly, warningOnly, verify, showHelp };
}

const USAGE = `
Usage: node scripts/hooks/check-docs-updated.ts [options]

Options:
  --staged            Read staged changes instead of the working tree.
  --warning-only      Do not block; just print the per-rule report.
  --verify            Verify doc-map + migration-log references, H1 structure,
                      front-matter metadata, stale active docs, doc readership,
                      and module-dir coverage (every src/modules/* dir must be
                      matched by a doc-map rule). Docs marked 'status: frozen'
                      are exempt from the freshness checks; exit(1) on problems.
  --help              Show this help text.

Environment:
  SKIP_DOC_CHECK=1    Bypass the blocking check (ignored with --warning-only).
`;

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.showHelp) {
    console.log(USAGE);
    return;
  }

  // Resolve the repo root explicitly so the script works when invoked from a
  // subdirectory (e.g. `node Lucent/scripts/hooks/check-docs-updated.ts`).
  const repoRoot = resolveRepoRoot();

  if (args.verify) {
    runVerify(repoRoot);
    return;
  }

  if (!args.warningOnly && process.env[BYPASS_ENV] === '1') {
    console.log(`[doc-check] Skipped (${BYPASS_ENV}=1)`);
    return;
  }

  if (!args.warningOnly) {
    checkMigrationLogOverwrite((cmd) => run(cmd, repoRoot));
  }

  const rules = loadDocMap(repoRoot);
  const changedFiles = getChangedFiles(args.stagedOnly, repoRoot);
  if (changedFiles.length === 0) {
    console.log('Documentation coverage: no changed files detected.');
    return;
  }
  const documentedFiles = changedFiles.filter((f) =>
    f.replace(/\\/g, '/').startsWith('docs/'),
  );
  const report = buildReport(rules, changedFiles, documentedFiles);
  console.log(renderReport(report));

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
│  (or any file under docs/logs/)                                 │
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
