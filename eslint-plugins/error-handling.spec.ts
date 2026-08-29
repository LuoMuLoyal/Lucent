import { describe, it, expect } from 'vitest';
import { parse as acornParse } from 'acorn';

/**
 * Parses a JavaScript expression string and returns the `callee` node of the
 * top-level CallExpression, unwrapping any ChainExpression wrappers.
 *
 * Example AST for `logger?.warn()`:
 *   ExpressionStatement
 *     └─ ChainExpression
 *          └─ CallExpression
 *               └─ callee: MemberExpression(logger, warn)
 *
 * Example AST for `obj?.foo.bar()`:
 *   ExpressionStatement
 *     └─ CallExpression
 *          └─ callee: MemberExpression
 *               ├─ object: ChainExpression → MemberExpression(obj, foo)
 *               └─ property: Identifier(bar)
 */
function parseCallee(code: string): import('estree').Node {
  // TODO(acorn9): `as unknown as import('estree').Program` is a type-system hack
  // needed because acorn.Node and estree.Node are maintained by different teams.
  // When upgrading to acorn 9.x (which plans to converge acorn-loose / estree
  // into a single type), switch to @types/estree or acorn's own ParseResult type.
  const ast = acornParse(code, {
    ecmaVersion: 2024,
    sourceType: 'module',
  }) as unknown as import('estree').Program;
  const stmt = ast.body[0] as import('estree').ExpressionStatement;
  let expr = stmt.expression as import('estree').Node;
  // Unwrap ChainExpression to get to the CallExpression
  if (expr.type === 'ChainExpression') {
    expr = (expr as import('estree').ChainExpression).expression;
  }
  const callExpr = expr as import('estree').CallExpression;
  return callExpr.callee;
}

// Import calleeToText from the error-handling plugin. The plugin file uses
// `import type { Rule } from 'eslint'` which is type-only, so it can be
// loaded at runtime.
import { calleeToTextInternal as calleeToText } from './error-handling';

describe('calleeToText', () => {
  it('recognises a simple identifier call: foo()', () => {
    expect(calleeToText(parseCallee('foo()'))).toBe('foo');
  });

  it('recognises a simple member expression: logger.warn()', () => {
    expect(calleeToText(parseCallee('logger.warn("x")'))).toBe('logger.warn');
  });

  it('recognises this.logger.warn()', () => {
    expect(calleeToText(parseCallee('this.logger.warn("x")'))).toBe(
      'this.logger.warn',
    );
  });

  it('recognises optional chaining: logger?.warn()', () => {
    expect(calleeToText(parseCallee('logger?.warn("x")'))).toBe('logger.warn');
  });

  it('recognises this?.logger?.warn()', () => {
    expect(calleeToText(parseCallee('this?.logger?.warn("x")'))).toBe(
      'this.logger.warn',
    );
  });

  it('recognises obj?.foo.bar() — chain in the middle', () => {
    expect(calleeToText(parseCallee('obj?.foo.bar()'))).toBe('obj.foo.bar');
  });

  it('recognises service?.logger.warn()', () => {
    expect(calleeToText(parseCallee('service?.logger.warn("x")'))).toBe(
      'service.logger.warn',
    );
  });

  it('recognises console.warn()', () => {
    expect(calleeToText(parseCallee('console.warn("x")'))).toBe('console.warn');
  });

  it('returns empty string for non-identifiable nodes', () => {
    expect(calleeToText(parseCallee('(function(){})()'))).toBe('');
  });
});
