/**
 * Write-side repository port for the `Memory` aggregate
 * (`domain/memory/memory.ts`, ADR-0024 §4).
 *
 * Three operations, and the shape of each is a decision:
 *
 * - `save` takes **many items at once** because one extraction produces a batch
 *   and a half-written batch is worse than none (the debounce would never retry
 *   it);
 * - `findRecent` returns newest-first and is the only read here, because the
 *   memory block is capped by `MAX_MEMORY_ITEMS` and "older than the cap" is not a
 *   fact anyone asks for;
 * - `clearAll` deletes **every** memory of one user, returning the count. It is
 *   bulk on purpose: erasing memory is a privacy entry point (the settings page),
 *   and a per-item API would leave "some memories" as a reachable state after a
 *   partial failure.
 *
 * Layer purity: types come from `domain/memory/` only (ADR-0024 rule D1).
 */

import type { MemoryItem, NewMemoryItem } from './memory.js';

export type { MemoryItem, NewMemoryItem };

/** DI token — string so Nest resolution errors name the port readably. */
export const ASSISTANT_MEMORIES = 'ASSISTANT_MEMORIES';

export interface MemoryRepositoryPort {
  /** Persists a batch of extracted memories; returns the number written. */
  save(userId: string, items: readonly NewMemoryItem[]): Promise<number>;

  /** The user's most recent memories, newest first. */
  findRecent(userId: string, limit: number): Promise<MemoryItem[]>;

  /** Erases every memory of the user (privacy entry point); returns the count. */
  clearAll(userId: string): Promise<number>;
}
