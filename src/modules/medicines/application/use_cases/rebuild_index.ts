import { Inject, Injectable } from '@nestjs/common';

import {
  MEDICINES_CACHE_MAINTENANCE,
  type MedicinesCacheMaintenancePort,
} from '../ports/cache_maintenance.js';

/**
 * Application-level cache invalidation use case. The cache internals it used
 * to walk directly live in `infrastructure/cache/maintenance.ts`; this class
 * keeps the public service name the module barrel exports.
 */
@Injectable()
export class MedicinesCacheAdminService {
  constructor(
    @Inject(MEDICINES_CACHE_MAINTENANCE)
    private readonly maintenance: MedicinesCacheMaintenancePort,
  ) {}

  invalidateAll(): Promise<number> {
    return this.maintenance.invalidateAll();
  }
}
