import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { I18nService } from 'nestjs-i18n';
import { notFound } from '../../../common/helpers/api-errors';
import { UserHealthContextRepositoryPort } from '../repositories';
import type {
  CreateCurrentMedicineDto,
  CreateHealthContextAllergyDto,
  CreateHealthContextConditionDto,
  HealthContextResponseData,
  UpdateCurrentMedicineDto,
  UpdateHealthContextAllergyDto,
  UpdateHealthContextConditionDto,
  UpdateHealthContextProfileDto,
} from '../dto';
import { UserHealthContextMapperService } from './mapper.service';
import { UserHealthContextProfileWriteService } from './profile-write.service';
import { UserHealthContextAllergyWriteService } from './allergy-write.service';
import { UserHealthContextConditionWriteService } from './condition-write.service';
import { UserHealthContextMedicineWriteService } from './medicine-write.service';
import {
  HEALTH_CONTEXT_CHANGED,
  type HealthContextChangedPayload,
} from '../../../common/events/domain-events.js';

@Injectable()
export class UserHealthContextService {
  private readonly logger = new Logger(UserHealthContextService.name);

  constructor(
    private readonly repository: UserHealthContextRepositoryPort,
    private readonly i18n: I18nService,
    private readonly mapperService: UserHealthContextMapperService,
    private readonly profileWriteService: UserHealthContextProfileWriteService,
    private readonly allergyWriteService: UserHealthContextAllergyWriteService,
    private readonly conditionWriteService: UserHealthContextConditionWriteService,
    private readonly medicineWriteService: UserHealthContextMedicineWriteService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getForUser(userId: string): Promise<HealthContextResponseData> {
    const user = await this.repository.findUserWithHealthContext(userId);
    if (!user) {
      notFound(this.i18n.t('auth.user_not_found'));
    }
    return this.mapperService.toResponse(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateHealthContextProfileDto,
  ): Promise<HealthContextResponseData> {
    await this.profileWriteService.upsertProfile(userId, dto);
    await this.emitHealthContextChanged(userId);
    return this.getForUser(userId);
  }

  // ── Allergy ──

  async createAllergy(userId: string, dto: CreateHealthContextAllergyDto) {
    await this.allergyWriteService.create(userId, dto);
    await this.emitHealthContextChanged(userId);
    return this.getForUser(userId);
  }

  async updateAllergy(
    userId: string,
    allergyId: string,
    dto: UpdateHealthContextAllergyDto,
  ) {
    await this.allergyWriteService.update(userId, allergyId, dto);
    await this.emitHealthContextChanged(userId);
    return this.getForUser(userId);
  }

  async deleteAllergy(userId: string, allergyId: string) {
    await this.allergyWriteService.softDelete(userId, allergyId);
    await this.emitHealthContextChanged(userId);
    return this.getForUser(userId);
  }

  // ── Condition ──

  async createCondition(userId: string, dto: CreateHealthContextConditionDto) {
    await this.conditionWriteService.create(userId, dto);
    await this.emitHealthContextChanged(userId);
    return this.getForUser(userId);
  }

  async updateCondition(
    userId: string,
    conditionId: string,
    dto: UpdateHealthContextConditionDto,
  ) {
    await this.conditionWriteService.update(userId, conditionId, dto);
    await this.emitHealthContextChanged(userId);
    return this.getForUser(userId);
  }

  async deleteCondition(userId: string, conditionId: string) {
    await this.conditionWriteService.softDelete(userId, conditionId);
    await this.emitHealthContextChanged(userId);
    return this.getForUser(userId);
  }

  // ── Current Medicine ──

  async createCurrentMedicine(userId: string, dto: CreateCurrentMedicineDto) {
    await this.medicineWriteService.create(userId, dto);
    await this.emitHealthContextChanged(userId);
    return this.getForUser(userId);
  }

  async updateCurrentMedicine(
    userId: string,
    medicineId: string,
    dto: UpdateCurrentMedicineDto,
  ) {
    await this.medicineWriteService.update(userId, medicineId, dto);
    await this.emitHealthContextChanged(userId);
    return this.getForUser(userId);
  }

  async deleteCurrentMedicine(userId: string, medicineId: string) {
    await this.medicineWriteService.softDelete(userId, medicineId);
    await this.emitHealthContextChanged(userId);
    return this.getForUser(userId);
  }

  private async emitHealthContextChanged(userId: string): Promise<void> {
    try {
      await this.eventEmitter.emitAsync(HEALTH_CONTEXT_CHANGED, {
        userId,
      } satisfies HealthContextChangedPayload);
    } catch (error) {
      this.logger.warn('Failed to emit health-context.changed event', {
        userId,
        error,
      });
    }
  }
}
