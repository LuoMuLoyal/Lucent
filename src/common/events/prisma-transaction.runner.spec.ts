import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '#generated/prisma/client.js';
import type { PrismaService } from '../../prisma/index.js';
import { PrismaTransactionRunner } from './prisma-transaction.runner.js';
import { activeTransaction } from './transaction-scope.js';

function makePrisma() {
  const tx = { marker: 'tx' } as unknown as Prisma.TransactionClient;
  const prisma = {
    $transaction: vi.fn(
      (fn: (client: Prisma.TransactionClient) => Promise<unknown>) => fn(tx),
    ),
  } as unknown as PrismaService;
  return { prisma, tx };
}

describe('PrismaTransactionRunner (ADR-0025 E0)', () => {
  it('runs the callback with the transaction client', async () => {
    const { prisma, tx } = makePrisma();
    const runner = new PrismaTransactionRunner(prisma);

    const seen = await runner.transaction((client) => Promise.resolve(client));

    expect(seen).toBe(tx);
  });

  it('registers the transaction so outbox appends can join it', async () => {
    const { prisma, tx } = makePrisma();
    const runner = new PrismaTransactionRunner(prisma);

    const ambient = await runner.transaction(() =>
      Promise.resolve(activeTransaction()),
    );

    expect(ambient).toBe(tx);
    expect(runner.inTransaction).toBe(false);
  });

  it('forwards Prisma transaction options', async () => {
    const { prisma } = makePrisma();
    const runner = new PrismaTransactionRunner(prisma);

    await runner.transaction(() => Promise.resolve(), {
      maxWait: 5_000,
      timeout: 20_000,
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 20_000,
    });
  });

  it('refuses to nest instead of silently losing atomicity', async () => {
    const { prisma } = makePrisma();
    const runner = new PrismaTransactionRunner(prisma);

    // The guard fires synchronously, before the inner transaction is opened:
    // a caller must not be able to reach Prisma's silent independent-connection
    // degradation even by accident.
    await expect(
      runner.transaction(() =>
        Promise.resolve().then(() =>
          runner.transaction(() => Promise.resolve('inner')),
        ),
      ),
    ).rejects.toThrow(/Nested transaction/);

    // The outer transaction was the only one opened.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('clears the ambient transaction when the callback throws', async () => {
    const { prisma } = makePrisma();
    const runner = new PrismaTransactionRunner(prisma);

    await expect(
      runner.transaction(() => Promise.reject(new Error('rollback'))),
    ).rejects.toThrow('rollback');

    expect(activeTransaction()).toBeNull();
  });
});
