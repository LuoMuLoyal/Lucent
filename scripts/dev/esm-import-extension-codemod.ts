/**
 * Idempotent codemod for the full-repo ESM switch.
 *
 * Rewrites module specifiers that the `moduleResolution: nodenext` +
 * `"type": "module"` runtime requires to carry an explicit extension:
 *
 *   1. Relative import/export/dynamic-import/require specifiers (start with
 *      `.` or `..`) get `.js` appended when they point to a `.ts` sibling or
 *      to a directory with an `index.ts` (in which case `/index.js` is used).
 *   2. The `#generated/prisma/client` specifier (maps through the package
 *      `imports` field to a `.js` file at runtime) gets `.js` appended.
 *
 * Specifiers that already carry an extension, are bare, or are unresolved
 * on disk are left untouched and reported. Running the codemod twice changes
 * nothing (idempotent).
 *
 * Usage (repo root): `node scripts/dev/esm-import-extension-codemod.ts`
 * Runs under Node 24 native TypeScript type stripping.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOTS = ['src', 'test', 'scripts', 'deploy'];
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'generated',
  '.git',
  '.swc',
]);
const EXTENSIONS_WITH_SUFFIX = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.jsx',
  '.json',
]);

interface ScanResult {
  rewrittenSpecifiers: number;
  rewrittenFiles: number;
  unresolved: Array<{ file: string; specifier: string }>;
}

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(thisDir, '../..');

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        files.push(...collectTsFiles(join(dir, entry.name)));
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

function fileExists(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a relative specifier against the importing file's directory and
 * return the on-disk sibling the specifier should point to (`x.ts` file or
 * `x/index.ts`), or `null` when nothing matches.
 */
function resolveRelativeTarget(file: string, specifier: string): string | null {
  const base = resolve(dirname(file), specifier);
  const hasTrailingSlash = specifier.endsWith('/');
  if (!hasTrailingSlash && fileExists(`${base}.ts`)) {
    return `${specifier}.js`;
  }
  if (!hasTrailingSlash && fileExists(`${base}.tsx`)) {
    return `${specifier}.js`;
  }
  if (!hasTrailingSlash && fileExists(`${base}.mts`)) {
    return `${specifier}.mjs`;
  }
  if (!hasTrailingSlash && fileExists(`${base}.cts`)) {
    return `${specifier}.cjs`;
  }
  if (fileExists(join(base, 'index.ts'))) {
    const indexSpecifier = hasTrailingSlash ? specifier : `${specifier}/`;
    return `${indexSpecifier}index.js`;
  }
  return null;
}

function needsExtension(specifier: string): boolean {
  if (!specifier.startsWith('.')) {
    return false;
  }
  const questionIdx = specifier.indexOf('?');
  const clean =
    questionIdx === -1 ? specifier : specifier.slice(0, questionIdx);
  const lastSegment = clean.split('/').pop() ?? '';
  return !EXTENSIONS_WITH_SUFFIX.has(extname(lastSegment));
}

/**
 * Regex capturing the whole quoted specifier following one of the supported
 * keywords. Matches:
 *   import X from './a'; export { X } from './a'; export * from './a';
 *   import('./a'); require('./a'); side-effect `import './a';`
 * Group 1 = leading keyword area (for context), Group 2 = full specifier.
 */
const SPECIFIER_RE =
  /((?:\bfrom\s*|\bexport\s+\*\s+from\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\()\s*)(['"])([^'"]+)\2/g;

function rewriteFile(file: string, result: ScanResult): void {
  const source = readFileSync(file, 'utf8');
  let output = '';
  let cursor = 0;
  let changed = false;

  SPECIFIER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SPECIFIER_RE.exec(source)) !== null) {
    const [full, keyword, quote, specifier] = match;
    const index = match.index;
    output += source.slice(cursor, index);
    cursor = index + full.length;

    let replacement: string | null = null;
    if (specifier === '#generated/prisma/client') {
      replacement = '#generated/prisma/client.js';
    } else if (needsExtension(specifier)) {
      replacement = resolveRelativeTarget(file, specifier);
      if (replacement === null) {
        result.unresolved.push({
          file: relative(repoRoot, file),
          specifier,
        });
      }
    }

    if (replacement !== null && replacement !== specifier) {
      output += `${keyword}${quote}${replacement}${quote}`;
      result.rewrittenSpecifiers += 1;
      changed = true;
    } else {
      output += full;
    }
  }
  output += source.slice(cursor);

  if (changed) {
    writeFileSync(file, output, 'utf8');
    result.rewrittenFiles += 1;
  }
}

function main(): void {
  const result: ScanResult = {
    rewrittenSpecifiers: 0,
    rewrittenFiles: 0,
    unresolved: [],
  };
  const files = ROOTS.flatMap((root) => collectTsFiles(join(repoRoot, root)));
  for (const file of files) {
    rewriteFile(file, result);
  }

  console.log(`Scanned ${files.length} .ts files`);
  console.log(
    `Rewrote ${result.rewrittenSpecifiers} specifiers across ${result.rewrittenFiles} files`,
  );
  if (result.unresolved.length > 0) {
    console.log(`Unresolved (left untouched): ${result.unresolved.length}`);
    for (const item of result.unresolved.slice(0, 40)) {
      console.log(`  ${item.file}: ${item.specifier}`);
    }
  } else {
    console.log('No unresolved relative specifiers.');
  }
}

main();
