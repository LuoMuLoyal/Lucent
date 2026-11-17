/**
 * Ambient transaction scope for the outbox (ADR-0025, step E0).
 *
 * Goal, stated precisely: **local-transactional outbox**. The outbox row must
 * commit or roll back with the aggregate write that produced the event, so the
 * "business write committed, process died, event never recorded" window closes.
 *
 * This is *not* a distributed transaction and does not make delivery
 * synchronous. Delivery stays at-least-once through the poller, consumers stay
 * idempotent, and the end-to-end system stays eventually consistent. Only the
 * pair (business state, pending event) is atomic — exactly the transactional
 * outbox pattern.
 *
 * Why ambient instead of an explicit `tx` parameter on every producer call:
 *
 * - There are ~18 transaction entry points across modules, each with its own
 *   closure. Threading a handle into every producer would either widen domain
 *   ports with Prisma types (forbidden by `ddd-application-no-direct-prisma`,
 *   and an untyped `object` hole the compiler cannot check) or force every
 *   caller to thread it by hand — one forgotten call silently reverts to the
 *   non-atomic path with no type error.
 * - With `AsyncLocalStorage` the atomic path is the *default*: a producer
 *   running inside a transaction joins it without being touched. A producer
 *   outside one keeps today's behaviour.
 *
 * `AsyncLocalStorage` does not leak across requests here: the store is bound to
 * the async call tree that entered `run()`, so concurrent requests never observe
 * each other's transaction.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '#generated/prisma/client.js';

const storage = new AsyncLocalStorage<Prisma.TransactionClient>();

/** The transaction active in this async context, if any. */
export function activeTransaction(): Prisma.TransactionClient | null {
  return storage.getStore() ?? null;
}

/**
 * Runs `fn` with `tx` as the ambient transaction.
 *
 * Called by the transaction runner only — business code goes through
 * `PrismaTransactionRunner.transaction()` and never has to know this module
 * exists.
 */
export function runInTransaction<T>(
  tx: Prisma.TransactionClient,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(tx, fn);
}
