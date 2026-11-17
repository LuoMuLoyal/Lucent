// Link integrity check for Lucent docs (CLI entry).
//
// Scans `docs/**/*.md`, parses markdown relative links (`[text](path)`),
// resolves targets against the file's own directory, and verifies the
// target file exists.
//
// Additionally validates path-like tokens (`docs/**`, `src/**`, `plans/**`,
// `scripts/**`, `test/**`, `prisma/**`, `monitoring/**`, `deploy/**` with a
// file extension) appearing in the docs surface, module READMEs, plans, and
// root entry docs, so renamed/moved files can never leave stale references
// behind.
//
// Excluded from scanning: `docs/archive/**` (frozen history — links rot
// by design, the folder is add-only) and `docs/reference/generated/**`
// (machine-generated artifacts, never hand-edited). Migration logs
// (`docs/logs/**`) are excluded from PATH validation only — they are
// append-only historical narrative that legitimately mentions removed paths.
//
// Modes:
// - Default: print a broken-link report without blocking.
// - Verify (--verify): exit(1) on any broken link (CI / pre-push gate).
//
// Run via `pnpm docs:links`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';

const VAULT_ROOT = 'docs';

interface BrokenLink {
  file: string;
  line: number;
  target: string;
  kind: 'markdown' | 'path';
}

// --- Walk docs tree -----------------------------------------------------
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

/** Frozen or generated trees that are exempt from link checking. */
const EXEMPT_DIRS = ['archive', join('reference', 'generated')];

function collectMarkdownFiles(repoRoot: string): string[] {
  const docsDir = resolve(repoRoot, VAULT_ROOT);
  if (!existsSync(docsDir)) return [];
  const docsBase = docsDir.replace(/\\/g, '/');
  return walkMarkdownFiles(docsDir)
    .map((f) => f.replace(docsBase + '/', `${VAULT_ROOT}/`))
    .filter(
      (f) => !EXEMPT_DIRS.some((dir) => f.startsWith(`${VAULT_ROOT}/${dir}/`)),
    );
}

/**
 * Files subject to path-token validation: the active docs surface plus
 * module/common READMEs, active plans, and root entry docs.
 *
 * Three append-only, point-in-time surfaces are excluded because they mention
 * since-removed paths *by design* and cannot be corrected without rewriting
 * history (AGENTS.md: migration logs and ADRs are append-only; dated plans are
 * snapshots):
 *   - `docs/logs/**`  — dated ledger
 *   - `docs/reference/adr/**` — decisions are never edited, only superseded
 *   - dated `plans/*.md` — handled in `collectPathCheckFiles` below
 * Link-target validation still applies to the first two (only path tokens are
 * skipped), so a genuinely broken Markdown link is still reported.
 */
/**
 * Resolves a repo-root-relative path against the workspace root **and** the app
 * roots under `apps/*`.
 *
 * Docs are written from a reader's point of view: "the code is at
 * `src/app.module.ts`". After the monorepo move that path lives at
 * `apps/monolith/src/app.module.ts`, and rewriting hundreds of doc lines to the
 * prefixed form would make them read like build output instead of prose. Instead
 * the checker accepts either location, so the docs stay readable while a genuinely
 * missing file is still reported.
 *
 * Returns the path as it should be recorded (relative to the workspace root), or
 * `null` when it exists nowhere.
 */
function resolveWithAppPrefixes(
  repoRoot: string,
  rel: string,
): string | null {
  const normalized = rel.replace(/\\/g, '/');
  if (existsSync(resolve(repoRoot, normalized))) return normalized;

  const appsDir = resolve(repoRoot, 'apps');
  if (!existsSync(appsDir)) return null;
  for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = `apps/${entry.name}/${normalized}`;
    if (existsSync(resolve(repoRoot, candidate))) return candidate;
  }
  return null;
}

function collectPathCheckFiles(
  repoRoot: string,
  docsFiles: string[],
): string[] {
  const set = new Set<string>();
  for (const f of docsFiles) {
    if (!f.startsWith('docs/logs/') && !f.startsWith('docs/reference/adr/')) {
      set.add(f);
    }
  }
  const add = (rel: string) => {
    const found = resolveWithAppPrefixes(repoRoot, rel);
    if (found !== null) set.add(found.replace(/\\/g, '/'));
  };
  // Resolved paths are workspace-root-relative, so anything that touches the
  // filesystem must resolve them against `repoRoot` first — the process cwd is
  // the app directory, not the workspace root.
  const modulesDir = resolveWithAppPrefixes(repoRoot, 'src/modules');
  if (modulesDir !== null) {
    for (const entry of readdirSync(resolve(repoRoot, modulesDir), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) add(`src/modules/${entry.name}/README.md`);
    }
  }
  add('src/common/README.md');
  const plansDir = resolve(repoRoot, 'plans');
  if (existsSync(plansDir)) {
    for (const entry of readdirSync(plansDir)) {
      // Dated plan files are point-in-time snapshots: executed plans mention
      // since-removed paths, and forward plans reference files that do not
      // exist yet. Only the living index is path-checked; the task ledger
      // lives at docs/TODO.md and enters via the docs surface above.
      if (entry === 'README.md') {
        add(`plans/${entry}`);
      }
    }
  }
  for (const root of [
    'README.md',
    'CONTRIBUTING.md',
    'AGENTS.md',
    'CLAUDE.md',
  ]) {
    add(root);
  }
  return [...set];
}

// --- Link parsing -------------------------------------------------------
const MARKDOWN_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

/** Skip fenced code blocks — link-looking text inside fences is not a link. */
function isLineInFence(line: string, inFence: boolean): boolean {
  return /^\s*(```|~~~)/.test(line) ? !inFence : inFence;
}

/**
 * Skip inline code spans — bracket syntax inside `backticks` is literal
 * text (e.g. a log entry describing `[text](path)` syntax), not a link.
 */
function isInsideInlineCode(line: string, index: number): boolean {
  let inside = false;
  for (let i = 0; i < index; i++) {
    if (line[i] === '`') inside = !inside;
  }
  return inside;
}

/** Strip `#anchor` / `#^block` suffixes; returns null for non-file targets. */
function stripAnchor(raw: string): string | null {
  const target = raw.split('#')[0].trim();
  if (!target) return null;
  return target;
}

/** True for protocol links (http:, https:, mailto:, tel:, data:, ...). */
function isProtocolLink(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

/**
 * Resolve a link target. Returns:
 * - `null` when the target is not a file reference (protocol, anchor, prose);
 * - `true` when the target file exists;
 * - `false` when the target file is missing.
 */
function targetExists(
  file: string,
  rawTarget: string,
  repoRoot: string,
): boolean | null {
  const target = stripAnchor(rawTarget);
  if (target === null) return null;
  if (target.startsWith('/') || isProtocolLink(target)) return null;
  // Targets containing spaces are almost certainly prose, not file paths.
  if (/\s/.test(target)) return null;

  // Markdown links resolve relative to the file's own directory.
  const base = dirname(file);
  const raw = /\.md$/i.test(target) ? `${base}/${target}` : `${base}/${target}.md`;
  // Lexically normalise (`docs/../src/...` → `src/...`) so the app-prefix
  // fallback sees a clean workspace-relative path instead of `..` segments.
  const path = relative(repoRoot, resolve(repoRoot, raw)).replace(/\\/g, '/');
  return resolveWithAppPrefixes(repoRoot, path) !== null;
}

function checkFile(file: string, repoRoot: string): BrokenLink[] {
  const full = resolve(repoRoot, file);
  if (!existsSync(full)) return [];
  const content = readFileSync(full, 'utf-8');
  const broken: BrokenLink[] = [];
  const lines = content.split(/\r?\n/);

  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    inFence = isLineInFence(line, inFence);
    if (inFence) continue;

    for (const m of line.matchAll(MARKDOWN_LINK_RE)) {
      // Skip image links: `![alt](path)` — the char before `[` is `!`.
      if (m.index > 0 && line[m.index - 1] === '!') continue;
      if (isInsideInlineCode(line, m.index ?? 0)) continue;
      const exists = targetExists(file, m[1], repoRoot);
      if (exists === null || exists) continue;
      broken.push({ file, line: i + 1, target: m[1], kind: 'markdown' });
    }
  }
  return broken;
}

// --- Path token validation (Phase 3 C3) --------------------------------
//
// Bare and inline-code path tokens must point at real files. Fenced code
// blocks are skipped (commands/templates); placeholder-ish tokens (globs,
// `<name>`, `YYYY-MM-DD`, any uppercase segment) are skipped so the check
// stays at zero false positives — a missed reference is acceptable, a wrong
// one is not.
//
// `.github/` is included because workflow files get renamed: a doc pointing at
// `lucent-ci.yml` after the split to `ci.yml` is exactly the rot this catches.
const PATH_TOKEN_RE =
  /(?:^|[\s(`"'\[>])((?:docs|src|plans|scripts|test|prisma|monitoring|deploy|\.github)\/[a-z0-9][a-zA-Z0-9_.\-/]*\.[a-z0-9]{1,6})(?=[\s)`"'\],.;:!?]|$)/g;

function isPlaceholderPath(token: string): boolean {
  return /[*<>{}]/.test(token) || /[A-Z]/.test(token);
}

function findBrokenPaths(file: string, repoRoot: string): BrokenLink[] {
  const full = resolve(repoRoot, file);
  if (!existsSync(full)) return [];
  const content = readFileSync(full, 'utf-8');
  const broken: BrokenLink[] = [];
  const lines = content.split(/\r?\n/);

  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    inFence = isLineInFence(line, inFence);
    if (inFence) continue;

    for (const m of line.matchAll(PATH_TOKEN_RE)) {
      const token = m[1];
      if (isPlaceholderPath(token)) continue;
      if (resolveWithAppPrefixes(repoRoot, token) === null) {
        broken.push({ file, line: i + 1, target: token, kind: 'path' });
      }
    }
  }
  return broken;
}

// --- Verify -------------------------------------------------------------
function runCheck(repoRoot: string, verify: boolean): void {
  const files = collectMarkdownFiles(repoRoot);
  const broken: BrokenLink[] = [];
  for (const file of files) broken.push(...checkFile(file, repoRoot));

  const pathFiles = collectPathCheckFiles(repoRoot, files);
  const brokenPaths: BrokenLink[] = [];
  for (const file of pathFiles) {
    brokenPaths.push(...findBrokenPaths(file, repoRoot));
  }

  if (broken.length === 0 && brokenPaths.length === 0) {
    console.log(
      `Link check passed (${files.length} markdown files, no broken links; ` +
        `${pathFiles.length} files path-checked, no missing paths).`,
    );
    return;
  }

  const report = [
    ...broken.map((b) => `- ${b.file}:${b.line} [${b.kind}] → "${b.target}"`),
    ...brokenPaths.map(
      (b) => `- ${b.file}:${b.line} [path] → "${b.target}" (not found)`,
    ),
  ];
  console.error(
    `Link check found ${broken.length + brokenPaths.length} problem(s):\n` +
      report.join('\n'),
  );
  if (verify) process.exit(1);
}

// --- Args ---------------------------------------------------------------
interface ParsedArgs {
  verify: boolean;
  showHelp: boolean;
}
function parseArgs(args: string[]): ParsedArgs {
  let verify = false,
    showHelp = false;
  for (const arg of args) {
    if (arg === '--verify') verify = true;
    else if (arg === '--help' || arg === '-h') showHelp = true;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return { verify, showHelp };
}

const USAGE = `
Usage: node scripts/docs/links.ts [options]

Scans docs/**/*.md and verifies markdown relative links resolve to existing
files. Also validates path-like tokens
(docs|src|plans|scripts|test|prisma|monitoring|deploy/**) across the docs surface,
module READMEs, plans, and root entry docs.

Options:
  --verify            Exit(1) on any broken link (CI gate).
  --help              Show this help text.
`;

/** Resolve the git worktree root; fall back to process.cwd() outside a repo. */
function resolveRepoRoot(verify: boolean): string {
  try {
    const top = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return top || process.cwd();
  } catch (error) {
    // --verify is the CI/pre-push gate: a missing git context would silently
    // scan the wrong root and report a false pass, so fail fast there.
    if (verify) {
      console.error(
        'docs:links: git rev-parse failed — --verify requires a git repository context:',
        error,
      );
      process.exit(1);
    }
    console.warn(
      'docs:links: git rev-parse failed, falling back to process.cwd():',
      error,
    );
    return process.cwd();
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.showHelp) {
    console.log(USAGE);
    return;
  }
  runCheck(resolveRepoRoot(args.verify), args.verify);
}

main();
