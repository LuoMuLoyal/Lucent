/**
 * Cache maintenance contract (`application/ports`).
 *
 * Enumerating and deleting cache keys is an infrastructure concern (it walks
 * cache-manager internals); the use case only needs "invalidate everything
 * under the medicines prefix".
 */

export const MEDICINES_CACHE_MAINTENANCE = 'MEDICINES_CACHE_MAINTENANCE';

export interface MedicinesCacheMaintenancePort {
  /** Deletes every key under the medicines prefix; returns the deleted count. */
  invalidateAll(): Promise<number>;
}
