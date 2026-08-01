import { format } from 'date-fns';

/**
 * Shared date-time helpers used across auth and other modules.
 */

/** Returns the current instant as a Date. */
export function now(): Date {
  return new Date();
}

/** Returns the current instant as an ISO-8601 string. */
export function nowIsoString(): string {
  return new Date().toISOString();
}

/**
 * Calculates remaining seconds until an ISO-8601 expiration instant.
 * Returns 0 if the instant is in the past.
 */
export function calculateExpiresIn(expiresAtIso: string): number {
  const diff = new Date(expiresAtIso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 1000));
}

/** Serializes a Date to an ISO-8601 string, or returns null. */
export function formatDateTime(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

/** Returns whether the user has a verified email timestamp. */
export function toEmailVerified(emailVerifiedAt: Date | null): boolean {
  return emailVerifiedAt !== null;
}

/** Returns "YYYY-MM-DD" string. */
export function formatDateOnly(value: Date): string;
export function formatDateOnly(value: null): null;
export function formatDateOnly(value: Date | null): string | null;
export function formatDateOnly(value: Date | null): string | null {
  return value != null ? format(value, 'yyyy-MM-dd') : null;
}

/** Parses a "YYYY-MM-DD" string into a UTC Date. */
export function parseDateOnly(value: string): Date {
  // Keep the explicit UTC constructor behavior; parseISO would apply the local
  // timezone and shift the stored instant on non-UTC runtimes.
  return new Date(`${value}T00:00:00.000Z`);
}

/** Default timezone applied when a user profile has no timezone set. */
export const DEFAULT_USER_TIMEZONE = 'Asia/Shanghai';

/**
 * Returns "YYYY-MM-DD" of the given instant rendered in the given IANA
 * timezone, falling back to [DEFAULT_USER_TIMEZONE] when timezone is null.
 * Uses the `en-CA` locale which natively produces ISO-style dates.
 */
export function formatDateOnlyInTimezone(
  date: Date,
  timezone: string | null,
): string {
  const tz = timezone || DEFAULT_USER_TIMEZONE;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const read = (type: string, fallback: string): string =>
    parts.find((part) => part.type === type)?.value ?? fallback;
  return `${read('year', '1970')}-${read('month', '01')}-${read('day', '01')}`;
}

/**
 * Calculates age from a birth date using UTC day boundaries.
 * Returns 0 when the birth date is in the future or results in a negative age.
 */
export function calculateAge(birthDate: Date): number {
  const today = new Date();
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();

  const hasHadBirthdayThisYear =
    today.getUTCMonth() > birthDate.getUTCMonth() ||
    (today.getUTCMonth() === birthDate.getUTCMonth() &&
      today.getUTCDate() >= birthDate.getUTCDate());

  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }

  return Math.max(age, 0);
}
