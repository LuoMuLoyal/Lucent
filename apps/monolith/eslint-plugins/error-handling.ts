/**
 * Local ESLint plugin enforcing ADR-0012 error-handling conventions.
 *
 * Rules:
 * - `error-handling/no-bare-throw-error`: forbid `throw new Error(...)` in
 *   non-test source files. Use `DomainFailureException` or NestJS
 *   `HttpException` subclasses instead.
 * - `error-handling/no-silent-catch`: forbid `catch {}` / `catch (e) {}`
 *   blocks whose body contains no logging or re-throw. Every catch must
 *   either log (warn/error/debug) or re-throw the error.
 */

import type { Rule } from 'eslint';

const LOGGING_PATTERNS = [
  'logger.warn',
  'logger.error',
  'logger.debug',
  'logger.log',
  'logger.info',
  'console.warn',
  'console.error',
  'console.log',
  'console.info',
  'console.debug',
  'this.logger',
];

/**
 * Walks the CatchClause.body and returns true if the block contains a
 * logging call or a `throw` statement anywhere in its statement tree.
 */
function bodyHasLoggingOrThrow(body: import('estree').Statement): boolean {
  if (body.type === 'BlockStatement') {
    for (const stmt of body.body) {
      if (statementHasLoggingOrThrow(stmt)) return true;
    }
    return false;
  }
  // Non-block body (e.g. `catch (e) => throw e`)
  return statementHasLoggingOrThrow(body);
}

function statementHasLoggingOrThrow(stmt: import('estree').Statement): boolean {
  switch (stmt.type) {
    case 'ThrowStatement':
      return true;
    case 'ExpressionStatement': {
      const expr = stmt.expression;
      // Check for logging calls: this.logger.warn(...), console.warn(...)
      if (expr.type === 'CallExpression') {
        const callee = expr.callee;
        const calleeText = calleeToText(callee);
        if (
          LOGGING_PATTERNS.some(
            (pat) => calleeText === pat || calleeText.startsWith(pat + '.'),
          )
        ) {
          return true;
        }
      }
      return false;
    }
    case 'BlockStatement': {
      for (const s of stmt.body) {
        if (statementHasLoggingOrThrow(s)) return true;
      }
      return false;
    }
    case 'IfStatement': {
      if (
        stmt.consequent &&
        statementHasLoggingOrThrow(
          stmt.consequent as import('estree').Statement,
        )
      )
        return true;
      if (
        stmt.alternate &&
        statementHasLoggingOrThrow(stmt.alternate as import('estree').Statement)
      )
        return true;
      return false;
    }
    case 'TryStatement': {
      if (stmt.block) {
        for (const s of stmt.block.body) {
          if (statementHasLoggingOrThrow(s)) return true;
        }
      }
      if (
        stmt.handler &&
        stmt.handler.body &&
        statementHasLoggingOrThrow(
          stmt.handler.body as import('estree').Statement,
        )
      )
        return true;
      return false;
    }
    default:
      return false;
  }
}

function calleeToText(callee: import('estree').Node): string {
  // Unwrap ChainExpression at the entry point so that optional chaining
  // in any position (top-level or mid-chain) is handled uniformly.
  // e.g. logger?.warn → MemberExpression(logger, warn)
  //      obj?.foo.bar() → MemberExpression(MemberExpression(obj, foo), bar)
  //      this?.logger?.warn → MemberExpression(this, logger, warn)
  const unwrapped =
    callee.type === 'ChainExpression' ? callee.expression : callee;
  if (unwrapped.type === 'MemberExpression') {
    // Recursively unwrap ChainExpression on the object side too, so
    // `obj?.foo.bar()` is recognised as 'obj.foo.bar'.
    const objNode =
      unwrapped.object.type === 'ChainExpression'
        ? unwrapped.object.expression
        : unwrapped.object;
    const obj =
      objNode.type === 'Identifier'
        ? objNode.name
        : objNode.type === 'MemberExpression'
          ? calleeToText(objNode)
          : objNode.type === 'ThisExpression'
            ? 'this'
            : '';
    const prop =
      unwrapped.property.type === 'Identifier' ? unwrapped.property.name : '';
    return prop ? `${obj}.${prop}` : obj;
  }
  if (unwrapped.type === 'Identifier') return unwrapped.name;
  return '';
}

const noBareThrowError: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid `throw new Error(...)` in non-test source files. Use `DomainFailureException` or NestJS `HttpException` subclasses.',
    },
    schema: [],
  },
  create(context) {
    return {
      ThrowStatement(node) {
        const arg = node.argument;
        if (arg == null) return;
        if (
          arg.type === 'NewExpression' &&
          arg.callee.type === 'Identifier' &&
          arg.callee.name === 'Error'
        ) {
          context.report({
            node,
            message:
              'Do not use `throw new Error()`. Use `DomainFailureException` for domain failures or NestJS `HttpException` subclasses for client errors. Add `// eslint-disable-next-line error-handling/no-bare-throw-error` with a reason if exempt.',
          });
        }
      },
    };
  },
};

const noSilentCatch: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid empty catch blocks. Every catch must log a warning/error or re-throw.',
    },
    schema: [],
  },
  create(context) {
    return {
      CatchClause(node) {
        // If there's no body, skip
        if (!node.body || node.body.body.length === 0) {
          context.report({
            node,
            message:
              'Empty catch block. Add a logging statement or re-throw the error.',
          });
          return;
        }

        const hasLogging = bodyHasLoggingOrThrow(
          node.body as import('estree').Statement,
        );
        if (!hasLogging) {
          context.report({
            node,
            message:
              'Silent catch block. Every catch must log (warn/error) or re-throw. Add `// eslint-disable-next-line error-handling/no-silent-catch` with a reason if exempt.',
          });
        }
      },
    };
  },
};

// Exported for unit tests (see error-handling.spec.ts).
export const calleeToTextInternal = calleeToText;

export const errorHandlingPlugin = {
  rules: {
    'no-bare-throw-error': noBareThrowError,
    'no-silent-catch': noSilentCatch,
  },
};
