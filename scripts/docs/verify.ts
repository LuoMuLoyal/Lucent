// Documentation structure check for Lucent (CLI entry).
//
// The code→docs coverage mapping (doc-map.yaml, report mode) was retired on
// 2026-09-15 after its two-week observation window (docs/TODO.md G1): the
// structural guarantees below cover its value, and per-area doc duties live
// in each `src/modules/<m>/README.md` plus the AGENTS.md doc rules.
//
// Modes:
// - Report (default / --report): doc freshness advisory, never blocks.
// - Verify (--verify): check migration-log plan/spec references, single-H1
//   structure, front-matter metadata (missing / stale `updated` /
//   `status: stale`), stale active docs, module README coverage, and the
//   migration-log append-only guard (a staged log-file diff deleting more
//   than 5 lines is a problem). `status: frozen` docs are exempt from the
//   freshness checks. exit(1) on problems.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  collectVerifyProblems,
  findDocsMissingFrontMatter,
  findStaleStatusDocs,
  findUncoveredModuleDirs,
  getStaleByFrontMatter,
  getStaleDocs,
  getTodayDate,
  getTodayLogPath,
  isActiveDoc,
  MIGRATION_LOG_DIR,
  MIGRATION_LOG_DIR_LEGACY,
  MIGRATION_LOG_PATH_RE,
  STALE_DOC_THRESHOLD_DAYS,
  withoutFrozenDocs,
} from './coverage.ts';

function run(cmd: string, cwd?: string): string {
  return execSync(cmd, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd,
  });
}

/** Resolve the git worktree root; fall back to process.cwd() outside a repo. */
function resolveRepoRoot(verify: boolean): string {
  try {
    const top = run('git rev-parse --show-toplevel').trim();
    return top || process.cwd();
  } catch (error) {
    // --verify is the CI/pre-push gate: a missing git context would silently
    // verify the wrong root and report a false pass, so fail fast there.
    if (verify) {
      console.error(
        'docs:verify: git rev-parse failed — --verify requires a git repository context:',
        error,
      );
      process.exit(1);
    }
    console.warn(
      'docs:verify: git rev-parse failed, falling back to process.cwd():',
      error,
    );
    return process.cwd();
  }
}

/**
 * Migration-log append-only guard: a working-tree diff against HEAD that
 * deletes more than 5 lines from a single log file is reported as a problem
 * (formerly the pre-commit blocking check, now folded into --verify).
 *
 * The diff runs over the whole tree with rename detection (`-M`) rather than
 * with a pathspec limited to the ledger dirs: a pathspec makes git report an
 * archival `git mv` out of the ledger as a plain deletion of every line, i.e.
 * a false overwrite. Rename entries are resolved to their destination, so a
 * move that also shrinks a log file is still caught.
 */
function collectLogOverwriteProblems(repoRoot: string): string[] {
  try {
    const out = run('git diff HEAD --numstat -M', repoRoot);
    const problems: string[] = [];
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\d+)\t(\d+)\t(.+)$/);
      if (!m) continue;
      const deleted = Number(m[2]);
      const file = resolveNumstatDestination(m[3].replace(/\\/g, '/'));
      if (deleted > 5 && MIGRATION_LOG_PATH_RE.test(file)) {
        problems.push(
          `${file}: migration-log append-only violation — ${deleted} deleted lines (>5) in one diff`,
        );
      }
    }
    return problems;
  } catch {
    // Outside a git repo or no diff available — nothing to guard here.
    return [];
  }
}

/**
 * Resolve a `--numstat` path to the post-change (new) path. Renames print as
 * `old => new`, brace-collapsed when the paths share a prefix
 * (`docs/{logs => archive}/x.md`); every other path passes through.
 */
function resolveNumstatDestination(numstatPath: string): string {
  const collapsed = /\{(.*?) => (.*?)\}/.exec(numstatPath);
  if (collapsed) return numstatPath.replace(collapsed[0], collapsed[2]);
  const arrow = numstatPath.indexOf(' => ');
  return arrow === -1 ? numstatPath : numstatPath.slice(arrow + 4);
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
  const availableDocs = collectAvailableDocs(repoRoot);
  const logFiles = collectLogFiles(repoRoot);
  // Authoring-time semantics apply to today's log wherever it lives
  // (new dir preferred; falls back to the legacy dir during transition).
  const legacyToday = `${MIGRATION_LOG_DIR_LEGACY}/${getTodayDate()}.md`;
  const canonicalToday = getTodayLogPath();
  const todayLogPath = logFiles.includes(canonicalToday)
    ? canonicalToday
    : legacyToday;
  const problems = collectVerifyProblems(repoRoot, logFiles, todayLogPath);

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
  // Every directory under src/modules/* must ship a code-adjacent README
  // (or a documented exemption) so new modules cannot land undocumented.
  const modulesDir = resolve(repoRoot, 'src', 'modules');
  if (existsSync(modulesDir)) {
    const moduleDirs = readdirSync(modulesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    problems.push(
      ...findUncoveredModuleDirs(moduleDirs, (dir) =>
        existsSync(resolve(modulesDir, dir, 'README.md')),
      ).map(
        (dir) =>
          `${dir}: module dir has no src/modules/${dir}/README.md — add one or a documented exemption`,
      ),
    );
  }

  problems.push(...collectLogOverwriteProblems(repoRoot));

  if (problems.length > 0) {
    console.error(
      'Doc verification failed:\n' + problems.map((p) => `- ${p}`).join('\n'),
    );
    process.exit(1);
  }
  console.log(
    'Doc verification passed (H1 structure, front-matter, freshness, module README coverage).',
  );
}

// --- Args --------------------------------------------------------------
interface ParsedArgs {
  verify: boolean;
  showHelp: boolean;
}
function parseArgs(args: string[]): ParsedArgs {
  let verify = false,
    showHelp = false;
  for (const arg of args) {
    // --report / --warning-only: report is the default mode — accept and no-op.
    if (arg === '--report' || arg === '--warning-only') continue;
    else if (arg === '--verify') verify = true;
    else if (arg === '--help' || arg === '-h') showHelp = true;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return { verify, showHelp };
}

const USAGE = `
Usage: node scripts/docs/verify.ts [options]

Options:
  --report            Print the doc freshness advisory (never blocks).
                      Default without flags.
  --warning-only      Alias of --report.
  --verify            Verify migration-log plan/spec references, H1 structure,
                      front-matter metadata, stale active docs, module README
                      coverage, and the migration-log append-only guard. Docs
                      marked 'status: frozen' are exempt from the freshness
                      checks; exit(1) on problems.
  --help              Show this help text.
`;

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.showHelp) {
    console.log(USAGE);
    return;
  }

  // Resolve the repo root explicitly so the script works when invoked from a
  // subdirectory (e.g. `node Lucent/scripts/docs/verify.ts`).
  const repoRoot = resolveRepoRoot(args.verify);

  if (args.verify) {
    runVerify(repoRoot);
    return;
  }

  console.log(
    'Documentation coverage mapping is retired (2026-09-15); doc duties live in module READMEs and AGENTS.md.',
  );
}

main();
