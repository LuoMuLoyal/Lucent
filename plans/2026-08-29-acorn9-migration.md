# Plan: acorn 9.x Type-Assertion Migration

Created: 2026-08-29
Tracking: `TODO(acorn9)` in `eslint-plugins/error-handling.spec.ts` and `package.json`

## Background

`eslint-plugins/error-handling.spec.ts` uses `as unknown as import('estree').Program`
to bridge `acorn.Node` and `estree.Node` types. acorn 9.x plans to converge
acorn-loose / estree into a single type, making this hack unnecessary.

## Scope

1. Upgrade `acorn` from `^8.18.0` to `^9.0.0` when released.
2. Replace `as unknown as import('estree').Program` with `@types/estree` or
   acorn's own `ParseResult` type in `error-handling.spec.ts`.
3. Remove the `//acorn` TODO key from `package.json` devDependencies.
4. Delete this plan file after completion.

## Prerequisites

- acorn 9.x must be released with converged estree types.
- All `calleeToText` tests must still pass after the type migration.

## References

- Review report: `plans/Lucent-review-08-29.md` (S-8)
- Affected file: `eslint-plugins/error-handling.spec.ts:22-29`
