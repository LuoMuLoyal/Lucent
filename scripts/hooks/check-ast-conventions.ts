// AST convention check for Lucent (CLI entry).
//
// Parses `src/**/*.dto.ts` and `src/**/*.controller.ts` with the TypeScript
// compiler API (`ts.createSourceFile`, syntax-level only — no full Program)
// and reports two WARN-level convention findings:
//
// - C1 dto-validator-missing: every non-static instance property of a class
//   in a DTO file must carry at least one class-validator decorator — any
//   decorator whose name starts with `Is` (e.g. `@IsString()`, or the repo
//   composites `@IsStrongPassword` / `@IsVerificationCode` /
//   `@IsEmailAddress` from src/common/validators/auth.decorators.ts).
//   Properties with `private`/`protected` modifiers are excluded: they are
//   injection members, not DTO data properties. No `@Exclude` exemption is
//   implemented — a repo-wide grep found zero `@Exclude` usage.
// - C2 endpoint-auth-posture: every method carrying an HTTP method decorator
//   (@Get/@Post/@Patch/@Put/@Delete/@Sse/...) must state its auth posture
//   explicitly via `@Public()` (src/modules/auth) or `@UseGuards(...)` on the
//   method or its class. No equivalent composite decorator exists in the repo
//   (no @Auth / @SkipAuth / @Roles — verified). The global JwtAuthGuard is
//   registered via APP_GUARD (src/app.module.ts), so unmarked endpoints rely
//   on the implicit default — exactly the drift this rule surfaces. Swagger
//   (`@ApiBearerAuth`) and rate-limit (`@Throttle`) decorators do not express
//   a posture and never satisfy the rule.
//
// Modes:
// - Default: print the WARN report without blocking (exit 0).
// - Strict (--strict): exit(1) when any WARN exists (reserved for the
//   planned WARN -> error promotion).
//
// Run via `node scripts/hooks/check-ast-conventions.ts`.
//
// The pure check functions are exported for tests
// (scripts/hooks/check-ast-conventions.spec.ts, run by `pnpm test:tools`).
// The CLI entry is guarded by an argv check (see bottom) so importing this
// module from the spec does not trigger a repo scan.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import ts from 'typescript';

export const RULE_DTO_VALIDATOR_MISSING = 'dto-validator-missing';
export const RULE_ENDPOINT_AUTH_POSTURE = 'endpoint-auth-posture';

/** NestJS HTTP method decorators that mark a controller method as an endpoint. */
export const HTTP_METHOD_DECORATORS: readonly string[] = [
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'Head',
  'Options',
  'All',
  'Sse',
];

/**
 * Decorators accepted as an explicit auth posture. `Public` comes from
 * src/modules/auth (SetMetadata-based opt-out of the global guard);
 * `UseGuards` is the NestJS built-in. Verified: the repo defines no other
 * composite auth decorator.
 */
export const AUTH_POSTURE_DECORATORS: readonly string[] = [
  'Public',
  'UseGuards',
];

/** A class-validator decorator must be named with this prefix. */
const VALIDATOR_NAME_PREFIX = 'Is';

export interface ConventionWarning {
  /** Repo-relative POSIX path of the scanned file. */
  file: string;
  /** 1-based line of the offending property/method. */
  line: number;
  rule: string;
  message: string;
}

// --- TypeScript AST helpers ---------------------------------------------
export function parseSourceFile(source: string): ts.SourceFile {
  return ts.createSourceFile(
    'inline.ts',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
}

/**
 * Decorators of a node. Modern TS AST (5.x+) carries decorators inside
 * `modifiers`; the legacy `decorators` field is checked as a fallback so the
 * helper stays robust across compiler versions.
 */
export function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  const modifiers = (node as { modifiers?: readonly ts.ModifierLike[] })
    .modifiers;
  const fromModifiers = (modifiers ?? []).filter((m): m is ts.Decorator =>
    ts.isDecorator(m),
  );
  if (fromModifiers.length > 0) return fromModifiers;
  return (node as { decorators?: readonly ts.Decorator[] }).decorators ?? [];
}

/** `@Foo`, `@Foo(...)`, `@Ns.Foo(...)` -> "Foo". Null when unresolvable. */
export function getDecoratorName(decorator: ts.Decorator): string | null {
  let expression = decorator.expression;
  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
    expression = expression.expression;
  }
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function hasDecoratorNamed(node: ts.Node, names: readonly string[]): boolean {
  return getDecorators(node).some((decorator) => {
    const name = getDecoratorName(decorator);
    return name !== null && names.includes(name);
  });
}

function hasModifierKind(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = (node as { modifiers?: readonly ts.ModifierLike[] })
    .modifiers;
  return (modifiers ?? []).some((modifier) => modifier.kind === kind);
}

function memberName(
  member: ts.PropertyDeclaration | ts.MethodDeclaration,
): string {
  const name = member.name;
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isPrivateIdentifier(name)
  ) {
    return name.text;
  }
  return '(computed)';
}

/**
 * 1-based line of a node. Pass `member.name` (not the member itself) so the
 * reported line skips leading decorators — `getStart()` on a decorated
 * member would point at the first decorator line instead.
 */
function lineNumber(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

// --- C1: DTO validator explicitness --------------------------------------
/**
 * Every non-static, non-private instance property of every class in a DTO
 * file must carry at least one decorator named with the `Is` prefix
 * (class-validator). WARNs otherwise.
 */
export function checkDtoValidatorExplicitness(
  file: string,
  source: string,
): ConventionWarning[] {
  const sourceFile = parseSourceFile(source);
  const warnings: ConventionWarning[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    for (const member of statement.members) {
      if (!ts.isPropertyDeclaration(member)) continue;
      // Static members are not DTO data.
      if (hasModifierKind(member, ts.SyntaxKind.StaticKeyword)) continue;
      // private/protected members are injection artifacts, not DTO data.
      if (
        hasModifierKind(member, ts.SyntaxKind.PrivateKeyword) ||
        hasModifierKind(member, ts.SyntaxKind.ProtectedKeyword)
      ) {
        continue;
      }
      const hasValidator = getDecorators(member).some((decorator) => {
        const name = getDecoratorName(decorator);
        return name !== null && name.startsWith(VALIDATOR_NAME_PREFIX);
      });
      if (hasValidator) continue;
      warnings.push({
        file,
        line: lineNumber(sourceFile, member.name),
        rule: RULE_DTO_VALIDATOR_MISSING,
        message: `property "${memberName(member)}" has no class-validator @Is* decorator`,
      });
    }
  }
  return warnings;
}

// --- C2: endpoint auth posture -------------------------------------------
/**
 * Every controller method decorated with an HTTP method decorator must state
 * its auth posture via `@Public()` or `@UseGuards(...)` — on the method or
 * its class. WARNs otherwise (endpoint relies on the implicit global guard).
 */
export function checkEndpointAuthPosture(
  file: string,
  source: string,
): ConventionWarning[] {
  const sourceFile = parseSourceFile(source);
  const warnings: ConventionWarning[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    const classHasPosture = hasDecoratorNamed(
      statement,
      AUTH_POSTURE_DECORATORS,
    );
    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const isEndpoint = getDecorators(member).some((decorator) => {
        const name = getDecoratorName(decorator);
        return name !== null && HTTP_METHOD_DECORATORS.includes(name);
      });
      if (!isEndpoint) continue;
      if (classHasPosture) continue;
      if (hasDecoratorNamed(member, AUTH_POSTURE_DECORATORS)) continue;
      warnings.push({
        file,
        line: lineNumber(sourceFile, member.name),
        rule: RULE_ENDPOINT_AUTH_POSTURE,
        message: `endpoint "${memberName(member)}()" has no explicit auth posture (@Public or @UseGuards)`,
      });
    }
  }
  return warnings;
}

// --- Repo scan -----------------------------------------------------------
function walkSourceFiles(dir: string, suffix: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkSourceFiles(full, suffix, out);
    else if (entry.name.endsWith(suffix)) out.push(full);
  }
}

/** Repo-relative POSIX paths (for display), sorted for stable output. */
function collectSourceFiles(repoRoot: string, suffix: string): string[] {
  const srcDir = resolve(repoRoot, 'src');
  if (!existsSync(srcDir)) return [];
  const out: string[] = [];
  walkSourceFiles(srcDir, suffix, out);
  return out
    .map((full) => `src/${full.slice(srcDir.length + 1).replace(/\\/g, '/')}`)
    .sort();
}

function runCheck(repoRoot: string, strict: boolean): void {
  const dtoFiles = collectSourceFiles(repoRoot, '.dto.ts');
  const controllerFiles = collectSourceFiles(repoRoot, '.controller.ts');

  const warnings: ConventionWarning[] = [];
  for (const file of dtoFiles) {
    const source = readFileSync(resolve(repoRoot, file), 'utf-8');
    warnings.push(...checkDtoValidatorExplicitness(file, source));
  }
  for (const file of controllerFiles) {
    const source = readFileSync(resolve(repoRoot, file), 'utf-8');
    warnings.push(...checkEndpointAuthPosture(file, source));
  }

  if (warnings.length === 0) {
    console.log(
      `AST convention check passed (${dtoFiles.length} dto files, ` +
        `${controllerFiles.length} controller files, no warnings).`,
    );
    return;
  }

  const byRule = new Map<string, number>();
  for (const warning of warnings) {
    byRule.set(warning.rule, (byRule.get(warning.rule) ?? 0) + 1);
  }
  const summary = [...byRule].map(([rule, n]) => `${rule}: ${n}`).join(', ');
  console.error(
    `AST convention check found ${warnings.length} warning(s) (${summary}):\n` +
      warnings
        .map((w) => `- ${w.file}:${w.line} [${w.rule}] ${w.message}`)
        .join('\n'),
  );
  if (strict) {
    console.error('Strict mode: warnings are treated as errors.');
    process.exit(1);
  }
}

// --- Args ---------------------------------------------------------------
interface ParsedArgs {
  strict: boolean;
  showHelp: boolean;
}
function parseArgs(args: string[]): ParsedArgs {
  let strict = false,
    showHelp = false;
  for (const arg of args) {
    if (arg === '--strict') strict = true;
    else if (arg === '--help' || arg === '-h') showHelp = true;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return { strict, showHelp };
}

const USAGE = `
Usage: node scripts/hooks/check-ast-conventions.ts [options]

Scans src/**/*.dto.ts and src/**/*.controller.ts and reports WARN-level
convention findings:
  C1 dto-validator-missing   DTO properties must carry a class-validator
                             @Is* decorator (private/protected members are
                             excluded as injection members).
  C2 endpoint-auth-posture   Controller endpoints must state their auth
                             posture via @Public() or @UseGuards(...) on the
                             method or its class.

Options:
  --strict            Exit(1) when any warning exists (WARN -> error gate).
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
  runCheck(resolveRepoRoot(), args.strict);
}

// CLI entry guard: run main() only when this file is the executed script,
// so the vitest spec can import the pure check functions safely. The repo
// typechecks scripts as CommonJS, which forbids import.meta — comparing the
// entry basename is sufficient: this file is only ever executed directly.
const entry = process.argv[1];
if (entry && basename(entry) === 'check-ast-conventions.ts') {
  main();
}
