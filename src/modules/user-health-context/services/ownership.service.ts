import { ensureOwnedByUser } from '../../../common/helpers/prisma-ownership.utils';
import { notFound } from '../../../common/helpers/api-errors';
import { Injectable } from '@nestjs/common';

import { I18nService } from 'nestjs-i18n';
import { UserHealthContextRepositoryPort } from '../repositories';

@Injectable()
export class UserHealthContextOwnershipService {
  constructor(
    private readonly repository: UserHealthContextRepositoryPort,
    private readonly i18n: I18nService,
  ) {}

  async ensureActiveUserExists(userId: string): Promise<void> {
    const user = await this.repository.findActiveUserById(userId);

    if (!user) {
      this.throwUserNotFound();
    }
  }

  async ensureAllergyOwnedByUser(
    userId: string,
    allergyId: string,
  ): Promise<void> {
    const allergy = await this.repository.findAllergyById(allergyId);

    ensureOwnedByUser(allergy, userId, this.i18n.t('auth.user_not_found'));
  }

  async ensureConditionOwnedByUser(
    userId: string,
    conditionId: string,
  ): Promise<void> {
    const condition = await this.repository.findConditionById(conditionId);

    ensureOwnedByUser(condition, userId, this.i18n.t('auth.user_not_found'));
  }

  async ensureCurrentMedicineOwnedByUser(
    userId: string,
    medicineId: string,
  ): Promise<void> {
    const medicine = await this.repository.findCurrentMedicineById(medicineId);

    ensureOwnedByUser(medicine, userId, this.i18n.t('auth.user_not_found'));
  }

  private throwUserNotFound(): never {
    notFound(this.i18n.t('auth.user_not_found'));
  }
}
