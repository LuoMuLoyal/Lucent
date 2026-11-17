/**
 * The one place that opens a Prisma transaction (ADR-0025, step E0).
 *
 * Every module's transaction entry point delegates here so the active
 * `Prisma.TransactionClient` is registered in the ambient scope
 * (`transaction-scope.ts`). That registration is what makes producer code —
 * `DomainEventPublisher.publish(...)` — join the caller's transaction without
 * receiving a handle, closing the "business committed, event lost" window.
 *
 * Two rules this runner exists to enforce:
 *
 * 1. **No nesting.** Prisma's nested `$transaction` silently degrades to a
 *    separate connection, dropping atomicity without any error. Calling
 *    `transaction()` inside another `transaction()` is a programming error, so
 *    it throws instead of quietly losing atomicity.
 * 2. **Outbox joins, side effects do not.** Queue enqueue and cache
 *    invalidation stay outside (they are not rollback-able and must not turn a
 *    committed write into a failed one); the outbox append is different because
 *    it is a database row in the same connection.
 */

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../prisma/index.js';
import { activeTransaction, runInTransaction } from './transaction-scope.js';

@Injectable()
export class PrismaTransactionRunner {
  constructor(private readonly prisma: PrismaService) {}

  /** Whether this async context is already inside a transaction. */
  get inTransaction(): boolean {
    return activeTransaction() != null;
  }

  /**
   * Runs `fn` in a transaction, registering it as the ambient transaction so
   * domain-event appends join it.
   *
   * `options.maxWait` / `options.timeout` map to Prisma's options bag for
   * callers that need a longer budget.
   */
  transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    if (this.inTransaction) {
      // Nested transactions are not a slower-but-correct path: Prisma hands
      // out a separate connection and the inner writes escape the outer
      // rollback. Failing loudly is the only safe behaviour.
      //
      // A violated invariant is not a domain failure (ADR-0012), so this is the
      // 500-family exception rather than a `DomainFailureException`.
      throw new InternalServerErrorException(
        'Nested transaction detected: Prisma would silently use an independent ' +
          'connection and lose atomicity. Reuse the outer transaction instead ' +
          'of opening a new one.',
      );
    }

    const run = (tx: Prisma.TransactionClient): Promise<T> =>
      runInTransaction(tx, () => fn(tx));

    return options == null
      ? this.prisma.$transaction(run)
      : this.prisma.$transaction(run, options);
  }
}
