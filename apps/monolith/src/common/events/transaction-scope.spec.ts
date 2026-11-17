import { describe, expect, it } from 'vitest';
import type { Prisma } from '#generated/prisma/client.js';
import { activeTransaction, runInTransaction } from './transaction-scope.js';

const tx = { marker: 'tx' } as unknown as Prisma.TransactionClient;

describe('transaction scope (ADR-0025 E0)', () => {
  it('reports no transaction outside a scope', () => {
    expect(activeTransaction()).toBeNull();
  });

  it('exposes the transaction inside a scope', async () => {
    const seen = await runInTransaction(tx, () =>
      Promise.resolve(activeTransaction()),
    );
    expect(seen).toBe(tx);
  });

  it('clears the transaction again after the scope settles', async () => {
    await runInTransaction(tx, () => Promise.resolve());
    expect(activeTransaction()).toBeNull();
  });

  it('clears the transaction even when the scoped work throws', async () => {
    await expect(
      runInTransaction(tx, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(activeTransaction()).toBeNull();
  });

  it('nests innermost-wins and restores the outer scope on exit', async () => {
    const inner = { marker: 'inner' } as unknown as Prisma.TransactionClient;

    const result = await runInTransaction(tx, async () => {
      const before = activeTransaction();
      const during = await runInTransaction(inner, () =>
        Promise.resolve(activeTransaction()),
      );
      return { before, during, after: activeTransaction() };
    });

    expect(result.before).toBe(tx);
    expect(result.during).toBe(inner);
    expect(result.after).toBe(tx);
  });

  it('keeps concurrent scopes isolated from each other', async () => {
    const other = { marker: 'other' } as unknown as Prisma.TransactionClient;

    const [a, b] = await Promise.all([
      runInTransaction(tx, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return activeTransaction();
      }),
      runInTransaction(other, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return activeTransaction();
      }),
    ]);

    expect(a).toBe(tx);
    expect(b).toBe(other);
  });
});
