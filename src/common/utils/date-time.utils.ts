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
  return value?.toISOString().slice(0, 10) ?? null;
}

/** Parses a "YYYY-MM-DD" string into a UTC Date. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
