/**
 * Long-term memory sidecar port (ADR-0024 `application/ports`).
 *
 * ## Why the service cannot import the client
 *
 * `AssistantMemoryService` used to import `Mem0ClientService` from
 * `infrastructure/` directly, which points the dependency outward (D2). The
 * port names what the service needs; the HTTP client implements it. That also
 * makes the "sidecar is down" cases testable without an HTTP server.
 *
 * ## Discriminated results, never exceptions
 *
 * Every method returns an outcome instead of throwing. Callers must be able to
 * tell "memory service unavailable" from "there is no memory"; an exception
 * tempts them into one `catch` that collapses both into "no memory" — that is
 * silent degradation, not degradation.
 */

/** One conversation turn handed to the sidecar for fact extraction. */
export interface MemoryTurnMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** One recalled memory with its relevance score. */
export interface MemoryHit {
  readonly id: string;
  readonly memory: string;
  readonly score: number;
}

/** Discriminated outcome for a memory write (fact extraction). */
export type MemoryAddResult =
  | { readonly ok: true; readonly added: number }
  | { readonly ok: false; readonly reason: string };

/** Discriminated outcome for a memory read. */
export type MemorySearchResult =
  | { readonly ok: true; readonly hits: readonly MemoryHit[] }
  | { readonly ok: false; readonly reason: string };

/** Discriminated outcome for the privacy erase. */
export type MemoryDeleteResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** DI token; a string so a Nest resolution error names the port readably. */
export const ASSISTANT_MEMORY_SIDECAR = 'ASSISTANT_MEMORY_SIDECAR';

/** What the memory service needs from the sidecar. */
export abstract class MemorySidecarPort {
  /** Whether the sidecar is enabled *and* has credentials to call it. */
  abstract isEnabled(): boolean;

  /** Hands the recent turns over for extraction; the sidecar dedups. */
  abstract addMemories(
    userId: string,
    messages: readonly MemoryTurnMessage[],
  ): Promise<MemoryAddResult>;

  /** Recalls this user's memories relevant to `query`. */
  abstract searchMemories(
    userId: string,
    query: string,
  ): Promise<MemorySearchResult>;

  /** Erases every memory of this user (privacy entry point). */
  abstract deleteAllForUser(userId: string): Promise<MemoryDeleteResult>;
}
