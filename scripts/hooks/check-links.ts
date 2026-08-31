// Link integrity check for Lucent docs (CLI entry).
//
// Scans `docs/**/*.md`, parses Obsidian wikilinks (`[[path|alias]]`) and
// markdown relative links (`[text](path)`), resolves targets against the
// `docs/` vault root (wikilinks) or the file's own directory (relative
// markdown links), and verifies the target file exists.
//
// Additionally validates path-like tokens (`docs/**`, `src/**`, `plans/**`,
// `scripts/**`, `test/**`, `deploy/**`, `prisma/**` with a file extension)
// appearing in the docs surface, module READMEs, plans, and root entry docs,
// so renamed/moved files can never leave stale references behind.
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
import { dirname, join, resolve } from 'node:path';

const VAULT_ROOT = 'docs';

interface BrokenLink {
  file: string;
  line: number;
  target: string;
  kind: 'wikilink' | 'markdown' | 'path';
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
 * module/common READMEs, active plans, and root entry docs. Migration logs
 * are excluded (append-only history mentions removed paths by design).
 */
function collectPathCheckFiles(
  repoRoot: string,
  docsFiles: string[],
): string[] {
  const set = new Set<string>();
  for (const f of docsFiles) {
    if (!f.startsWith('docs/logs/')) set.add(f);
  }
  const add = (rel: string) => {
    if (existsSync(resolve(repoRoot, rel))) set.add(rel.replace(/\\/g, '/'));
  };
  const modulesDir = resolve(repoRoot, 'src', 'modules');
  if (existsSync(modulesDir)) {
    for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) add(`src/modules/${entry.name}/README.md`);
    }
  }
  add('src/common/README.md');
  const plansDir = resolve(repoRoot, 'plans');
  if (existsSync(plansDir)) {
    for (const entry of readdirSync(plansDir)) {
      // Dated plan files are point-in-time snapshots: executed plans mention
      // since-removed paths, and forward plans reference files that do not
      // exist yet. Only the living index is path-checked; the TODO ledger
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
const WIKILINK_RE = /\[\[([^\[\]]+)\]\]/g;
const MARKDOWN_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

/** Skip fenced code blocks — link-looking text inside fences is not a link. */
function isLineInFence(line: string, inFence: boolean): boolean {
  return /^\s*(```|~~~)/.test(line) ? !inFence : inFence;
}

/**
 * Skip inline code spans — bracket syntax inside `backticks` is literal
 * text (e.g. a log entry describing `[[old-note]]` syntax), not a link.
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

/** Obsidian short-link lookup: basename match (case-insensitive) across the vault. */
function findByBasename(allFiles: string[], name: string): boolean {
  const stem = name.toLowerCase();
  return allFiles.some((f) => {
    const base = f.slice(f.lastIndexOf('/') + 1);
    return base.toLowerCase().replace(/\.md$/i, '') === stem;
  });
}

/**
 * Resolve a link target. Returns:
 * - `null` when the target is not a file reference (protocol, anchor, prose);
 * - `true` when the target file exists (or matches by basename);
 * - `false` when the target file is missing.
 */
function targetExists(
  file: string,
  rawTarget: string,
  kind: 'wikilink' | 'markdown',
  repoRoot: string,
  allFiles: string[],
): boolean | null {
  const target = stripAnchor(rawTarget);
  if (target === null) return null;
  if (target.startsWith('/') || isProtocolLink(target)) return null;
  // Targets containing spaces are almost certainly prose, not file paths.
  if (/\s/.test(target)) return null;

  // Obsidian short links: a wikilink without `/` resolves by basename
  // across the whole vault (e.g. [[deploy]] → howto/deploy.md).
  if (kind === 'wikilink' && !target.includes('/')) {
    if (findByBasename(allFiles, target)) return true;
    // Fall through to vault-root path resolution.
  }

  let base: string;
  if (target.startsWith('./') || target.startsWith('../')) {
    base = dirname(file); // explicit relative path — resolve from the file
  } else if (kind === 'wikilink') {
    base = VAULT_ROOT; // Obsidian short links resolve from the vault root
  } else {
    base = dirname(file); // standard markdown relative link
  }

  const path = /\.md$/i.test(target)
    ? `${base}/${target}`
    : `${base}/${target}.md`;
  if (existsSync(resolve(repoRoot, path))) return true;

  // Fallback: a path-style wikilink may be relative to the current file's
  // directory (e.g. [[adr/0004-...]] written from reference/).
  if (kind === 'wikilink' && base === VAULT_ROOT) {
    const rel = /\.md$/i.test(target)
      ? `${dirname(file)}/${target}`
      : `${dirname(file)}/${target}.md`;
    return existsSync(resolve(repoRoot, rel));
  }
  return false;
}

function checkFile(
  file: string,
  repoRoot: string,
  allFiles: string[],
): BrokenLink[] {
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

    for (const m of line.matchAll(WIKILINK_RE)) {
      if (isInsideInlineCode(line, m.index ?? 0)) continue;
      const rawTarget = m[1].split('|')[0];
      const exists = targetExists(
        file,
        rawTarget,
        'wikilink',
        repoRoot,
        allFiles,
      );
      if (exists === null || exists) continue;
      broken.push({ file, line: i + 1, target: rawTarget, kind: 'wikilink' });
    }
    for (const m of line.matchAll(MARKDOWN_LINK_RE)) {
      // Skip image links: `![alt](path)` — the char before `[` is `!`.
      if (m.index > 0 && line[m.index - 1] === '!') continue;
      if (isInsideInlineCode(line, m.index ?? 0)) continue;
      const exists = targetExists(file, m[1], 'markdown', repoRoot, allFiles);
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
const PATH_TOKEN_RE =
  /(?:^|[\s(`"'\[>])((?:docs|src|plans|scripts|test|deploy|prisma)\/[a-z0-9][a-zA-Z0-9_.\-/]*\.[a-z0-9]{1,6})(?=[\s)`"'\],.;:!?]|$)/g;

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
      if (!existsSync(resolve(repoRoot, token))) {
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
  for (const file of files) broken.push(...checkFile(file, repoRoot, files));

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
Usage: node scripts/hooks/check-links.ts [options]

Scans docs/**/*.md and verifies Obsidian wikilinks and markdown relative
links resolve to existing files (vault root = docs/). Also validates
path-like tokens (docs|src|plans|scripts|test|deploy|prisma/**) across the
docs surface, module READMEs, plans, and root entry docs.

Options:
  --verify            Exit(1) on any broken link (CI gate).
  --help              Show this help text.
`;

/** Resolve the git worktree root; fall back to process.cwd() outside a repo. */
function resolveRepoRoot(): string {
  try {
    const top = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return top || process.cwd();
  } catch {
    return process.cwd();
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.showHelp) {
    console.log(USAGE);
    return;
  }
  runCheck(resolveRepoRoot(), args.verify);
}

main();
