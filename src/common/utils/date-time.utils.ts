import { format } from 'date-fns';

/**
 * Shared date-time helpers used across auth and other modules.
 */

export function calculateExpiresIn(expiresAtIso: string): number {
  const diff = new Date(expiresAtIso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 1000));
}

export function formatDateTime(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

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
