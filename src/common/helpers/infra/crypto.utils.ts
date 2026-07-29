import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 *
 * Both inputs are converted to `Buffer` and compared with
 * `crypto.timingSafeEqual`. Returns `false` immediately (but in
 * constant time relative to length) when lengths differ.
 */
export function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
