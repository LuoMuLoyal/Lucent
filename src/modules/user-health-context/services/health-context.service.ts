import { Injectable } from '@nestjs/common';
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

@Injectable()
export class UserHealthContextService {
  constructor(
    private readonly repository: UserHealthContextRepositoryPort,
    private readonly i18n: I18nService,
    private readonly mapperService: UserHealthContextMapperService,
    private readonly profileWriteService: UserHealthContextProfileWriteService,
    private readonly allergyWriteService: UserHealthContextAllergyWriteService,
    private readonly conditionWriteService: UserHealthContextConditionWriteService,
    private readonly medicineWriteService: UserHealthContextMedicineWriteService,
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
    return this.getForUser(userId);
  }

  // ── Allergy ──

  async createAllergy(userId: string, dto: CreateHealthContextAllergyDto) {
    await this.allergyWriteService.create(userId, dto);
    return this.getForUser(userId);
  }

  async updateAllergy(
    userId: string,
    allergyId: string,
    dto: UpdateHealthContextAllergyDto,
  ) {
    await this.allergyWriteService.update(userId, allergyId, dto);
    return this.getForUser(userId);
  }

  async deleteAllergy(userId: string, allergyId: string) {
    await this.allergyWriteService.softDelete(userId, allergyId);
    return this.getForUser(userId);
  }

  // ── Condition ──

  async createCondition(userId: string, dto: CreateHealthContextConditionDto) {
    await this.conditionWriteService.create(userId, dto);
    return this.getForUser(userId);
  }

  async updateCondition(
    userId: string,
    conditionId: string,
    dto: UpdateHealthContextConditionDto,
  ) {
    await this.conditionWriteService.update(userId, conditionId, dto);
    return this.getForUser(userId);
  }

  async deleteCondition(userId: string, conditionId: string) {
    await this.conditionWriteService.softDelete(userId, conditionId);
    return this.getForUser(userId);
  }

  // ── Current Medicine ──

  async createCurrentMedicine(userId: string, dto: CreateCurrentMedicineDto) {
    await this.medicineWriteService.create(userId, dto);
    return this.getForUser(userId);
  }

  async updateCurrentMedicine(
    userId: string,
    medicineId: string,
    dto: UpdateCurrentMedicineDto,
  ) {
    await this.medicineWriteService.update(userId, medicineId, dto);
    return this.getForUser(userId);
  }

  async deleteCurrentMedicine(userId: string, medicineId: string) {
    await this.medicineWriteService.softDelete(userId, medicineId);
    return this.getForUser(userId);
  }
}
