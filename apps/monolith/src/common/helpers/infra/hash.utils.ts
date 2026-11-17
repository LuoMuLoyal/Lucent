import { createHash } from 'node:crypto';

/**
 * Produces a short hexadecimal hash (default 16 chars / 64 bits) from the
 * given input string. Used for cache keys where collision resistance is
 * sufficient at 64 bits and the full 256-bit digest is unnecessary.
 *
 * @param value  Input string to hash.
 * @param length Truncation length in hex characters (default 16).
 */
export function makeShortHash(value: string, length = 16): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}
