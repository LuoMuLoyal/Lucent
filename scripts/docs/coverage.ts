// Doc coverage shared logic — pure/testable. Node 24 native TS, ESM syntax.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const REPO_TIMEZONE = 'Asia/Shanghai';
export const STALE_DOC_THRESHOLD_DAYS = 90;

/** Canonical migration-log dir (new structure) and its legacy counterpart. */
export const MIGRATION_LOG_DIR = 'docs/logs/migration-log';
export const MIGRATION_LOG_DIR_LEGACY = 'docs/02-logs/migration-log';
/** Matches the migration log under both the new and the legacy dir. */
export const MIGRATION_LOG_PATH_RE =
  /^docs\/(?:02-logs|logs)\/migration-log\/.+\.md$/;

/**
 * Active docs that MUST stay fresh (2026-08-31 Diátaxis layout).
 * Deliberately NOT active: `docs/archive/**` (frozen history),
 * `docs/reference/generated/**` (build artifacts),
 * `docs/logs/migration-log/*` (append-only ledger, guarded by the
 * overwrite check instead of freshness).
 */
export const ACTIVE_DOC_PATTERNS: string[] = [
  'docs/README.md',
  'docs/explanation/*.md',
  'docs/reference/*.md',
  'docs/reference/adr/*.md',
  'docs/howto/*.md',
];

export function isActiveDoc(path: string): boolean {
  return ACTIVE_DOC_PATTERNS.some((p) => matchesPattern(path, p));
}

// --- YAML front-matter -------------------------------------------------
/**
 * Content docs that MUST carry front-matter (status / owner / quadrant /
 * updated). `reference/` and `howto/` require it; `explanation/` is gate-free
 * (freshness still applies via git last-modified) and ADRs are append-only.
 */
export const FRONT_MATTER_REQUIRED_PATTERNS: string[] = [
  'docs/reference/*.md',
  'docs/howto/*.md',
];

export function isFrontMatterRequired(path: string): boolean {
  return FRONT_MATTER_REQUIRED_PATTERNS.some((p) => matchesPattern(path, p));
}

export interface DocFrontMatter {
  status?: string;
  owner?: string;
  quadrant?: string;
  updated?: string;
}

/** Parse a leading `---` YAML front-matter block (Obsidian-compatible). */
export function parseFrontMatter(content: string): DocFrontMatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return {};
  const fm: DocFrontMatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (kv) (fm as Record<string, string>)[kv[1]] = kv[2].trim();
  }
  return fm;
}

/** Docs that should carry front-matter but do not (or have an empty block). */
export function findDocsMissingFrontMatter(
  activeDocs: string[],
  contentByPath: Record<string, string>,
): string[] {
  return activeDocs.filter((path) => {
    if (!isFrontMatterRequired(path)) return false;
    const content = contentByPath[path];
    if (content === undefined) return false;
    const fm = parseFrontMatter(content);
    return !(fm.status && fm.owner && fm.quadrant && fm.updated);
  });
}

/** Active docs whose front-matter `updated` is older than thresholdDays. */
export function getStaleByFrontMatter(
  activeDocs: string[],
  contentByPath: Record<string, string>,
  today: string,
  thresholdDays = STALE_DOC_THRESHOLD_DAYS,
): string[] {
  const todayMs = Date.parse(today);
  return activeDocs.filter((path) => {
    const content = contentByPath[path];
    if (content === undefined) return false;
    const fm = parseFrontMatter(content);
    if (fm.status !== 'active' || !fm.updated) return false;
    const ms = Date.parse(fm.updated);
    if (Number.isNaN(ms)) return false;
    return todayMs - ms > thresholdDays * 86_400_000;
  });
}

/** Active docs explicitly marked `status: stale` but not yet archived. */
export function findStaleStatusDocs(
  activeDocs: string[],
  contentByPath: Record<string, string>,
): string[] {
  return activeDocs.filter((path) => {
    const content = contentByPath[path];
    if (content === undefined) return false;
    return parseFrontMatter(content).status === 'stale';
  });
}

/**
 * Docs intentionally frozen (`status: frozen`): exempt from the freshness
 * checks (both front-matter `updated` and git last-modified), but still must
 * carry valid front-matter. Distinct from `status: stale`, which means the
 * doc should be archived.
 */
export function isFrozenDoc(content: string | undefined): boolean {
  if (content === undefined) return false;
  return parseFrontMatter(content).status === 'frozen';
}

/**
 * Paths that are NOT marked `status: frozen` in their front-matter. The git
 * last-modified freshness check uses this so frozen docs stay exempt without
 * duplicating the front-matter gate at every call site.
 */
export function withoutFrozenDocs(
  paths: string[],
  contentByPath: Record<string, string>,
): string[] {
  return paths.filter((path) => !isFrozenDoc(contentByPath[path]));
}

// --- Glob matching ------------------------------------------------------
// `*` matches a single path segment; `**` matches multiple segments.
// Used by the front-matter / active-doc pattern lists below.
export function globToRegExp(pattern: string): RegExp {
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

export function matchesPattern(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return globToRegExp(pattern).test(normalized);
}

// --- YAML front-matter -------------------------------------------------
export function getTodayDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

export function getTodayLogPath(): string {
  return `${MIGRATION_LOG_DIR}/${getTodayDate()}.md`;
}

// --- Verify mode --------------------------------------------------------
const PLAN_REF = /(?:plans\/[\w./-]+\.md|\.trae\/specs\/[\w./-]+)/g;

export function extractPlanReferences(content: string): string[] {
  return [...new Set(content.match(PLAN_REF) ?? [])];
}

export function hasMultipleH1(content: string): boolean {
  let inFence = false;
  let h1Count = 0;
  for (const line of content.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^#\s+/.test(line)) h1Count++;
  }
  return h1Count > 1;
}

/** Active docs whose last git modification is older than thresholdDays. */
export function getStaleDocs(
  activeDocs: string[],
  lastModifiedByPath: Record<string, string>,
  today: string,
  thresholdDays = STALE_DOC_THRESHOLD_DAYS,
): string[] {
  const todayMs = Date.parse(today);
  return activeDocs.filter((path) => {
    const d = lastModifiedByPath[path];
    if (!d) return false; // untracked → skip
    const ms = Date.parse(d);
    if (Number.isNaN(ms)) return false;
    return todayMs - ms > thresholdDays * 86_400_000;
  });
}

/**
 * Module dirs under `src/modules/*` intentionally exempt from documentation
 * governance coverage checks. Keep this list minimal — document the reason
 * next to each entry.
 */
export const EXEMPT_MODULE_PATTERNS: string[] = [];

/**
 * Module dirs under `src/modules/*` without a code-adjacent `README.md`.
 * New modules must ship with a `src/modules/<m>/README.md` so their changes
 * are governed. `readmeExists` is injectable so the branch is testable;
 * `exemptions` skips documented exceptions.
 */
export function findUncoveredModuleDirs(
  moduleDirs: string[],
  readmeExists: (dir: string) => boolean,
  exemptions: string[] = EXEMPT_MODULE_PATTERNS,
): string[] {
  return moduleDirs.filter(
    (dir) => !exemptions.includes(dir) && !readmeExists(dir),
  );
}

export function collectVerifyProblems(
  repoRoot: string,
  logFiles: string[],
  todayLogPath: string,
): string[] {
  const problems: string[] = [];
  for (const log of logFiles) {
    const full = resolve(repoRoot, log);
    if (!existsSync(full)) continue;
    const content = readFileSync(full, 'utf-8');
    for (const ref of extractPlanReferences(content)) {
      // Skip references explicitly marked as deleted ("计划文件已删" nearby).
      const idx = content.indexOf(ref);
      const context = content.slice(
        Math.max(0, idx - 20),
        idx + ref.length + 20,
      );
      if (context.includes('已删') || context.includes('已删除')) continue;
      // `.trae/specs/` refs live at the workspace root (one level above the repo);
      // `plans/` refs are repo-local.
      const refPath = ref.startsWith('.trae/')
        ? resolve(repoRoot, '..', ref)
        : resolve(repoRoot, ref);
      if (!existsSync(refPath)) {
        // Only today's log is authoring-time. Orphan plan references in
        // history are expected: AGENTS rules delete plans after completion.
        if (log === todayLogPath) {
          problems.push(`${log}: orphan plan/spec reference "${ref}"`);
        }
      }
    }
    if (hasMultipleH1(content)) {
      problems.push(
        `${log}: multiple H1 headings (keep one "# title", use "##" for sections)`,
      );
    }
  }
  return problems;
}
