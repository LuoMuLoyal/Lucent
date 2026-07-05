const crypto = require('node:crypto');

const STABLE_ID_NAMESPACE = 'lucent:medicine-import';

function formatUuid(buffer) {
  const hex = buffer.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function normalizeStableIdPart(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

/**
 * Generates a deterministic UUIDv5-compatible identifier from arbitrary parts.
 * Same inputs always produce the same UUID, making it safe for idempotent upserts.
 */
function stableUuid(...parts) {
  const hash = crypto.createHash('sha1');
  hash.update(STABLE_ID_NAMESPACE);
  hash.update('::');
  hash.update(parts.map(normalizeStableIdPart).join('||'));

  const bytes = Buffer.from(hash.digest().subarray(0, 16));

  // Shape the first 16 digest bytes into a UUIDv5-compatible layout.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuid(bytes);
}

module.exports = { stableUuid, normalizeStableIdPart };
