/**
 * Data-ownership verification service for user-health-context.
 *
 * This is NOT a NestJS Guard. It is imported by domain services to ensure
 * health-context rows belong to the current user before mutating them.
 */
import { ensureOwnedByUser } from '../../../common/utils/prisma-ownership.helper';
import { notFound } from '../../../common/utils/api-errors';
import { nonDeleted } from '../../../common/utils/prisma.helpers';
import { Injectable } from '@nestjs/common';

import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class UserHealthContextOwnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async ensureActiveUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        ...nonDeleted,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      this.throwUserNotFound();
    }
  }

  async ensureAllergyOwnedByUser(
    userId: string,
    allergyId: string,
  ): Promise<void> {
    const allergy = await this.prisma.userAllergy.findUnique({
      where: { id: allergyId },
      select: { userId: true },
    });

    ensureOwnedByUser(allergy, userId, this.i18n.t('auth.user_not_found'));
  }

  async ensureConditionOwnedByUser(
    userId: string,
    conditionId: string,
  ): Promise<void> {
    const condition = await this.prisma.userCondition.findUnique({
      where: { id: conditionId },
      select: { userId: true },
    });

    ensureOwnedByUser(condition, userId, this.i18n.t('auth.user_not_found'));
  }

  async ensureCurrentMedicineOwnedByUser(
    userId: string,
    medicineId: string,
  ): Promise<void> {
    const medicine = await this.prisma.userCurrentMedicine.findUnique({
      where: { id: medicineId },
      select: { userId: true },
    });

    ensureOwnedByUser(medicine, userId, this.i18n.t('auth.user_not_found'));
  }

  private throwUserNotFound(): never {
    notFound(this.i18n.t('auth.user_not_found'));
  }
}
