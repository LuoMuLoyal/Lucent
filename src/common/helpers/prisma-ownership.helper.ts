import { notFound } from './api-errors';

/**
 * Validates that a queried record exists and belongs to the given user.
 * Throws NotFoundException if the record is missing or owned by another user.
 */
export function ensureOwnedByUser<T extends { userId: string }>(
  record: T | null | undefined,
  userId: string,
  notFoundMessage: string,
): asserts record is T {
  if (!record || record.userId !== userId) {
    notFound(notFoundMessage);
  }
}
