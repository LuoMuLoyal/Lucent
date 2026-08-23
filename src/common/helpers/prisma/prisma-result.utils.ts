import { Prisma } from '#generated/prisma/client';
import { createDomainFailure, fromPromise } from '../../result';
import type { DomainFailure, ResultAsync } from '../../result';

/**
 * Maps a known Prisma Client request error to a domain failure.
 *
 * Currently recognised codes:
 * - `P2002` unique constraint violation -> `RESOURCE_CONFLICT`
 * - `P2025` record required but not found -> `RESOURCE_NOT_FOUND`
 *
 * Unknown errors are left unmapped so callers can re-throw them as
 * infrastructure/programming errors rather than masking them as 4xx.
 */
export function mapPrismaKnownRequestError(
  error: unknown,
): DomainFailure | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return createDomainFailure({
        kind: 'conflict',
        code: 'RESOURCE_CONFLICT',
      });
    }
    if (error.code === 'P2025') {
      return createDomainFailure({
        kind: 'not_found',
        code: 'RESOURCE_NOT_FOUND',
      });
    }
  }
  return undefined;
}

/**
 * Lifts a Prisma promise into a `ResultAsync<T, DomainFailure>`.
 *
 * Known request errors are converted to recoverable domain failures; any other
 * rejection (connection loss, transaction/serialization errors, programming
 * mistakes) is re-thrown so it reaches the global exception filter and
 * observability stack unchanged.
 */
export function fromPrismaResult<T>(
  promise: Promise<T>,
): ResultAsync<T, DomainFailure> {
  return fromPromise(promise, (error) => {
    const failure = mapPrismaKnownRequestError(error);
    if (failure) return failure;
    throw error;
  });
}
