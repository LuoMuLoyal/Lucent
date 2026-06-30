import { notFound } from '../../../common/utils/api-errors';
import { nonDeleted } from '../../../common/utils/prisma.helpers';
import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { PrismaService } from '../../../prisma/prisma.service';
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
import { UserHealthContextMapperService } from './user-health-context-mapper.service';
import { UserHealthContextProfileWriteService } from './user-health-context-profile-write.service';
import { UserHealthContextAllergyWriteService } from './user-health-context-allergy-write.service';
import { UserHealthContextConditionWriteService } from './user-health-context-condition-write.service';
import { UserHealthContextMedicineWriteService } from './user-health-context-medicine-write.service';
import { userHealthContextInclude } from '../types/user-health-context.types';

@Injectable()
export class UserHealthContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
    private readonly mapperService: UserHealthContextMapperService,
    private readonly profileWriteService: UserHealthContextProfileWriteService,
    private readonly allergyWriteService: UserHealthContextAllergyWriteService,
    private readonly conditionWriteService: UserHealthContextConditionWriteService,
    private readonly medicineWriteService: UserHealthContextMedicineWriteService,
  ) {}

  async getForUser(userId: string): Promise<HealthContextResponseData> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, ...nonDeleted },
      include: userHealthContextInclude,
    });
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
