/**
 * Shared utilities for object-key construction and public-URL encoding.
 *
 * All feature modules that need to build S3/COS object keys or
 * construct public URLs from `ObjectStorageConfig.publicBaseUrl`
 * should use these helpers to ensure consistent path formatting
 * and URL encoding.
 */

import { randomUUID } from 'node:crypto';
import { now } from '../helpers/format/date-time.utils.js';

/**
 * Builds a date-partitioned object key.
 *
 * Format: `{prefix}/{userId}/{YYYY}/{MM}/{DD}/{uuid}{extension}`
 *
 * @param prefix   Path prefix (e.g. `'daily-records'`, `'exports'`).
 * @param userId   The owner user ID.
 * @param extension File extension including the dot (e.g. `'.jpg'`,
 *                  `'.pdf'`), or empty string if none.
 * @returns The fully-qualified object key.
 */
export function createDatePartitionedObjectKey(
  prefix: string,
  userId: string,
  extension: string,
): string {
  const currentTime = now();
  const year = String(currentTime.getUTCFullYear());
  const month = String(currentTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(currentTime.getUTCDate()).padStart(2, '0');
  return `${prefix}/${userId}/${year}/${month}/${day}/${randomUUID()}${extension}`;
}

/**
 * Builds a flat (non-date-partitioned) object key.
 *
 * Format: `{prefix}/{userId}/{uuid}{extension}`
 */
export function createFlatObjectKey(
  prefix: string,
  userId: string,
  extension: string,
): string {
  return `${prefix}/${userId}/${randomUUID()}${extension}`;
}

/**
 * URL-encodes an object key, preserving `/` path separators.
 *
 * Each path segment is individually `encodeURIComponent`-ed so that
 * spaces, non-ASCII characters, and URL-reserved characters are safely
 * encoded without corrupting the `/` delimiters.
 */
export function encodeObjectKey(objectKey: string): string {
  return objectKey
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

/**
 * Builds a public URL from a base URL and an object key.
 *
 * @param publicBaseUrl The base URL from `ObjectStorageConfig`.
 * @param objectKey     The object key to append.
 * @returns The fully-qualified public URL, or `null` if
 *          `publicBaseUrl` is empty/whitespace.
 */
export function buildPublicUrl(
  publicBaseUrl: string,
  objectKey: string,
): string | null {
  const baseUrl = publicBaseUrl.trim();
  if (!baseUrl) {
    return null;
  }
  return `${baseUrl.replace(/\/+$/, '')}/${encodeObjectKey(objectKey)}`;
}
