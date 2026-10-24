import { Inject, Injectable } from '@nestjs/common';
import { unwrapResult } from '../../../../common/result/index.js';
import { AuditLogService } from '../../../audit-log/index.js';
import {
  MEDICINE_SAFETY_TIP_REPOSITORY,
  type MedicineSafetyTipAdminInput,
  type MedicineSafetyTipAdminPatch,
  type MedicineSafetyTipRepositoryPort,
} from '../ports/safety-tips.js';
import { MEDICINES_CACHE_MAINTENANCE } from '../ports/cache-maintenance.js';
import type { MedicinesCacheMaintenancePort } from '../ports/cache-maintenance.js';

export type { MedicineSafetyTipAdminInput, MedicineSafetyTipAdminPatch };

/**
 * Owner service for the medication safety-tip content
 * (`medicine_safety_tips`), exposed to the admin console through the
 * `content:read`/`content:write` surface.
 *
 * Every mutation journals the actor and a before/after summary, then flushes
 * the medicines read cache: the public `GET /medicines/safety-tips` endpoint
 * serves a cached random subset, so an edit that does not invalidate would
 * never reach the client.
 */
@Injectable()
export class SafetyTipsAdminService {
  constructor(
    private readonly auditLog: AuditLogService,
    @Inject(MEDICINE_SAFETY_TIP_REPOSITORY)
    private readonly safetyTipRepository: MedicineSafetyTipRepositoryPort,
    @Inject(MEDICINES_CACHE_MAINTENANCE)
    private readonly cacheMaintenance: MedicinesCacheMaintenancePort,
  ) {}

  async list() {
    return this.safetyTipRepository.listAll();
  }

  async create(actorUserId: string, input: MedicineSafetyTipAdminInput) {
    const tip = await this.safetyTipRepository.create(input);
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.content.safety_tip.create',
        resourceType: 'medicine_safety_tip',
        resourceId: tip.id,
        metadata: { before: null, after: tip },
      }),
    );
    await this.cacheMaintenance.invalidateAll();
    return tip;
  }

  async update(
    actorUserId: string,
    id: string,
    input: MedicineSafetyTipAdminPatch,
  ) {
    const before = await this.safetyTipRepository.findEditable(id);
    if (before === null) return null;
    const tip = await this.safetyTipRepository.update(id, input);
    if (tip === null) return null;
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.content.safety_tip.update',
        resourceType: 'medicine_safety_tip',
        resourceId: id,
        metadata: { before, after: tip },
      }),
    );
    await this.cacheMaintenance.invalidateAll();
    return tip;
  }

  async remove(actorUserId: string, id: string) {
    const before = await this.safetyTipRepository.findEditable(id);
    if (before === null) return false;
    await this.safetyTipRepository.remove(id);
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.content.safety_tip.delete',
        resourceType: 'medicine_safety_tip',
        resourceId: id,
        metadata: { before, after: null },
      }),
    );
    await this.cacheMaintenance.invalidateAll();
    return true;
  }
}
