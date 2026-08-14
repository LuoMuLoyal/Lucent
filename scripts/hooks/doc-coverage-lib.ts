// Doc coverage shared logic — pure/testable. Node 24 native TS, ESM syntax.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const BYPASS_ENV = 'SKIP_DOC_CHECK';
export const DOC_MAP_PATH = 'docs/doc-map.yaml';
export const MIGRATION_LOG_MAX_DELETIONS = 5;
export const REPO_TIMEZONE = 'Asia/Shanghai';
export const STALE_DOC_THRESHOLD_DAYS = 90;

/** Active docs that MUST stay fresh — everything outside 03-archive. */
export const ACTIVE_DOC_PATTERNS: string[] = [
  'docs/README.md',
  'docs/00-current/*.md',
  'docs/01-reference/*.md',
  'docs/01-reference/adr/*.md',
  'docs/01-reference/contracts/*.md',
  'docs/01-reference/how-to/*.md',
  'docs/02-logs/README.md',
];

export function isActiveDoc(path: string): boolean {
  return ACTIVE_DOC_PATTERNS.some((p) => matchesPattern(path, p));
}

// --- YAML front-matter -------------------------------------------------
/** Content docs that MUST carry front-matter (status / owner / quadrant / updated). */
export const FRONT_MATTER_REQUIRED_PATTERNS: string[] = [
  'docs/00-current/*.md',
  'docs/01-reference/*.md',
  'docs/01-reference/how-to/*.md',
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

export interface DocCoverageRule {
  name: string;
  codePatterns: string[];
  requiredDocs: string[]; // docs_required — ALL must be touched
  anyOfDocs: string[]; // docs_any_of — AT LEAST ONE must be touched
  infoDocs: string[]; // docs_info — informational only
}

export interface DocCoverageMatch {
  ruleName: string;
  touchedCodeFiles: string[];
  missingRequired: string[];
  missingAnyOf: string[];
  missingInfo: string[];
}

// --- Glob matching ------------------------------------------------------
// `*` matches a single path segment; `**` matches multiple segments.
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

// --- YAML parsing (extended schema) ------------------------------------
export function parseDocMapYaml(source: string): DocCoverageRule[] {
  const rules: DocCoverageRule[] = [];
  let currentName: string | null = null;
  let currentCode: string[] | null = null;
  let currentRequired: string[] | null = null;
  let currentAnyOf: string[] | null = null;
  let currentInfo: string[] | null = null;
  let currentSection:
    | 'code'
    | 'docs_required'
    | 'docs_any_of'
    | 'docs_info'
    | null = null;
  let inRules = false;

  function commitRule(): void {
    if (currentName !== null) {
      rules.push({
        name: currentName,
        codePatterns: currentCode ?? [],
        requiredDocs: currentRequired ?? [],
        anyOfDocs: currentAnyOf ?? [],
        infoDocs: currentInfo ?? [],
      });
    }
  }

  for (const rawLine of source.split(/\r?\n/)) {
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
      currentRequired = [];
      currentAnyOf = [];
      currentInfo = [];
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
    if (trimmed === 'docs_any_of:') {
      currentSection = 'docs_any_of';
      continue;
    }
    if (trimmed === 'docs_info:') {
      currentSection = 'docs_info';
      continue;
    }
    if (trimmed.startsWith('- ')) {
      const value = trimmed.substring(2).trim();
      if (currentSection === 'code') currentCode?.push(value);
      else if (currentSection === 'docs_required') currentRequired?.push(value);
      else if (currentSection === 'docs_any_of') currentAnyOf?.push(value);
      else if (currentSection === 'docs_info') currentInfo?.push(value);
      else
        throw new Error(`Unexpected list item outside a rule section: ${line}`);
      continue;
    }
    throw new Error(`Unsupported doc-map.yaml line: ${line}`);
  }
  commitRule();
  return rules;
}

export function loadDocMap(repoRoot: string): DocCoverageRule[] {
  const configPath = resolve(repoRoot, DOC_MAP_PATH);
  if (!existsSync(configPath)) {
    throw new Error(`Doc coverage config not found: ${configPath}`);
  }
  return parseDocMapYaml(readFileSync(configPath, 'utf-8'));
}

// --- Report building (3-tier) ------------------------------------------
export interface Report {
  matchedRules: DocCoverageMatch[];
  hasWarnings: boolean;
  hasInfos: boolean;
}

export function buildReport(
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

    const missingRequired = rule.requiredDocs.filter(
      (docPattern) =>
        !normalizedDocs.some((docFile) => matchesPattern(docFile, docPattern)),
    );
    const missingAnyOf =
      rule.anyOfDocs.length > 0 &&
      !rule.anyOfDocs.some((docPattern) =>
        normalizedDocs.some((docFile) => matchesPattern(docFile, docPattern)),
      )
        ? rule.anyOfDocs
        : [];
    const missingInfo = rule.infoDocs.filter(
      (docPattern) =>
        !normalizedDocs.some((docFile) => matchesPattern(docFile, docPattern)),
    );

    matches.push({
      ruleName: rule.name,
      touchedCodeFiles,
      missingRequired,
      missingAnyOf,
      missingInfo,
    });
  }

  return {
    matchedRules: matches,
    hasWarnings: matches.some(
      (m) => m.missingRequired.length > 0 || m.missingAnyOf.length > 0,
    ),
    hasInfos: matches.some((m) => m.missingInfo.length > 0),
  };
}

export function renderReport(report: Report): string {
  if (report.matchedRules.length === 0) {
    return 'Documentation coverage: no mapped code changes detected.';
  }
  if (!report.hasWarnings && !report.hasInfos) {
    return 'Documentation coverage: all mapped doc targets were updated.';
  }
  const buffer: string[] = [];
  for (const match of report.matchedRules) {
    if (
      match.missingRequired.length === 0 &&
      match.missingAnyOf.length === 0 &&
      match.missingInfo.length === 0
    ) {
      continue;
    }
    buffer.push(`- Rule: ${match.ruleName}`);
    buffer.push(`  Code changes: ${match.touchedCodeFiles.join(', ')}`);
    if (match.missingRequired.length > 0) {
      buffer.push(
        `  Required docs not updated: ${match.missingRequired.join(', ')}`,
      );
    }
    if (match.missingAnyOf.length > 0) {
      buffer.push(`  Update at least one of: ${match.missingAnyOf.join(', ')}`);
    }
    if (match.missingInfo.length > 0) {
      buffer.push(
        `  Suggested docs (optional): ${match.missingInfo.join(', ')}`,
      );
    }
  }
  if (report.hasWarnings) {
    buffer.push('This is warning-only and does not block the workflow.');
  } else {
    buffer.push('No required docs missing — suggestions only.');
  }
  return buffer.join('\n');
}

// --- Timezone-aware date helpers ----------------------------------------
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
  return `docs/02-logs/migration-log/${getTodayDate()}.md`;
}

// --- Migration log overwrite detection ---------------------------------
export function checkMigrationLogOverwrite(run: (cmd: string) => string): void {
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
      console.error(
        `\nMigration Log Overwrite Detected:\n${file}\nhas ${deletionCount} deleted lines in staged diff (max ${MIGRATION_LOG_MAX_DELETIONS}).\nMigration logs must be appended to, not overwritten.\nTo bypass: SKIP_DOC_CHECK=1 git commit ...\n`,
      );
      process.exit(1);
    }
  }
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

/** Literal (non-glob) doc paths referenced by rules that do not exist. */
export function findDocMapOrphans(
  rules: DocCoverageRule[],
  availableFiles: string[],
): string[] {
  const orphans: string[] = [];
  for (const rule of rules) {
    for (const p of [
      ...rule.requiredDocs,
      ...rule.anyOfDocs,
      ...rule.infoDocs,
    ]) {
      if (p.includes('*')) continue;
      if (!availableFiles.includes(p))
        orphans.push(`${rule.name}: "${p}" does not exist`);
    }
  }
  return orphans;
}

/** Glob doc patterns referenced by rules that match no existing file. */
export function findDocMapGlobOrphans(
  rules: DocCoverageRule[],
  availableFiles: string[],
): string[] {
  const orphans: string[] = [];
  for (const rule of rules) {
    for (const p of [
      ...rule.requiredDocs,
      ...rule.anyOfDocs,
      ...rule.infoDocs,
    ]) {
      if (!p.includes('*')) continue;
      if (!availableFiles.some((f) => matchesPattern(f, p))) {
        orphans.push(`${rule.name}: glob "${p}" matches no existing file`);
      }
    }
  }
  return orphans;
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

/** Docs with a standing reader channel (AGENTS Read First / README nav / subdir READMEs). */
export const EXEMPT_UNREFERENCED_PATTERNS: string[] = [
  'docs/01-reference/adr/**',
  'docs/01-reference/how-to/**',
  'docs/01-reference/contracts/**',
  'docs/01-reference/deployment.md',
  'docs/01-reference/environment-variables.md',
];

/**
 * Module dirs under `src/modules/*` intentionally exempt from doc-map coverage.
 * Keep this list minimal — prefer adding a doc-map rule over an exemption.
 * Document the reason next to each entry.
 */
export const EXEMPT_MODULE_PATTERNS: string[] = [];

/**
 * Module dirs under `src/modules/*` not matched by any rule's `code` glob.
 * New modules must ship with a doc-map rule so their changes are governed.
 * `exemptions` is injectable so the branch is testable; defaults to the
 * documented exemption list.
 */
export function findUncoveredModuleDirs(
  rules: DocCoverageRule[],
  moduleDirs: string[],
  exemptions: string[] = EXEMPT_MODULE_PATTERNS,
): string[] {
  return moduleDirs.filter((dir) => {
    if (exemptions.includes(dir)) return false;
    // Every NestJS module has a `<name>.module.ts` at its root (repo convention);
    // probe with that file so both glob and literal code patterns can match.
    const probe = `src/modules/${dir}/${dir}.module.ts`;
    return !rules.some((rule) =>
      rule.codePatterns.some((pattern) => matchesPattern(probe, pattern)),
    );
  });
}

/** Active docs (except READMEs and standing-channel docs) not referenced by any doc-map rule. */
export function findUnreferencedActiveDocs(
  rules: DocCoverageRule[],
  activeDocs: string[],
): string[] {
  const referenced = new Set<string>();
  for (const rule of rules) {
    for (const p of [
      ...rule.requiredDocs,
      ...rule.anyOfDocs,
      ...rule.infoDocs,
    ]) {
      for (const doc of activeDocs) {
        if (matchesPattern(doc, p)) referenced.add(doc);
      }
    }
  }
  return activeDocs.filter(
    (doc) =>
      !referenced.has(doc) &&
      !doc.endsWith('/README.md') &&
      !EXEMPT_UNREFERENCED_PATTERNS.some((p) => matchesPattern(doc, p)),
  );
}

export function collectVerifyProblems(
  repoRoot: string,
  rules: DocCoverageRule[],
  availableFiles: string[],
  logFiles: string[],
  todayLogPath: string,
): string[] {
  const problems: string[] = [
    ...findDocMapOrphans(rules, availableFiles),
    ...findDocMapGlobOrphans(rules, availableFiles),
  ];
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
