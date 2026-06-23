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
