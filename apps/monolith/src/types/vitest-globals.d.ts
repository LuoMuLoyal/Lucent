/* eslint-disable @typescript-eslint/consistent-type-imports */

/**
 * Extends the global `vi` (declared by `vitest/globals`) with type-level
 * members so that `vi.Mock`, `vi.Mocked<T>`, etc. work the same way
 * `jest.Mock`, `jest.Mocked<T>` did with `@types/jest`.
 *
 * This allows a straight `jest.` → `vi.` codemod across all test files
 * without needing per-file `import type { Mock } from 'vitest'`.
 */
declare global {
  namespace vi {
    type Mock = import('vitest').Mock;
    type Mocked<T> = import('vitest').Mocked<T>;
    type MockedFunction<T> = import('vitest').MockedFunction<T>;
    type MockedClass<T> = import('vitest').MockedClass<T>;
    type MockedObject<T> = import('vitest').MockedObject<T>;
    /** Alias for MockInstance (Vitest 4 renamed from SpyInstance). */
    type MockInstance<T = unknown> = import('vitest').MockInstance<T>;
    /** Legacy Jest-compatible name; resolves to Vitest MockInstance. */
    type SpyInstance<T = unknown> = import('vitest').MockInstance<T>;
  }
}

export {};
