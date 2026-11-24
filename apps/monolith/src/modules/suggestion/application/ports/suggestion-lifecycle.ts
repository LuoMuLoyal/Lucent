import type { SuggestionCandidate } from '../../domain/suggestion/suggestion-candidate.js';
import type { SuggestionAction } from '../../domain/signal/signal.js';

/**
 * Persistence port for the suggestion lifecycle write/read paths.
 *
 * `LifecycleService` used to call `PrismaService` directly, which put a Prisma
 * import inside `application/` — forbidden by ADR-0024 §4.2 (`application/`
 * depends on `domain/` and its own ports only). The port keeps the same
 * operations; the Prisma implementation lives in
 * `infrastructure/persistence/suggestion-lifecycle.ts`.
 *
 * `create` takes a plain, fully-resolved input object rather than Prisma's
 * generated `create` payload: the generated type rejects the conditional
 * spread this service uses to omit absent optional columns under
 * `exactOptionalPropertyTypes`, and modelling the columns here keeps the
 * application layer free of that concern.
 */
export interface PersistActiveInput {
  userId: string;
  date: string;
  candidate: SuggestionCandidate;
  copy: { title: string; reason: string; boundary: string };
  locale: string;
  generatedAt: string;
  sourceVersion?: number;
}

/** A persisted card reduced to what the dedupe key needs. */
export interface ActiveCardKey {
  ruleId: string;
  subtype: string | null;
}

export abstract class SuggestionLifecycleStore {
  /** Inserts a new active card and returns its id. */
  abstract createActive(input: PersistActiveInput): Promise<string>;

  /** Expires every active card for `userId`+`date`; returns how many changed. */
  abstract expireActive(
    userId: string,
    date: string,
    expiredAt: string,
    sourceVersion?: number,
  ): Promise<number>;

  /** Moves one active card to dismissed. */
  abstract dismissActive(userId: string, suggestionId: string): Promise<void>;

  /** `ruleId`+`subtype` keys of the active cards for `userId`+`date`. */
  abstract listActiveCardKeys(
    userId: string,
    date: string,
  ): Promise<ActiveCardKey[]>;

  /** `ACTIVE → FADING` for cards older than `threshold`. */
  abstract fadeActiveBefore(threshold: Date): Promise<number>;

  /** `FADING → EXPIRED` for cards older than `threshold`. */
  abstract expireFadingBefore(threshold: Date): Promise<number>;
}

export const SUGGESTION_LIFECYCLE_STORE = 'SUGGESTION_LIFECYCLE_STORE';

/** Re-exported so the implementation and callers share one shape. */
export type { SuggestionAction };
