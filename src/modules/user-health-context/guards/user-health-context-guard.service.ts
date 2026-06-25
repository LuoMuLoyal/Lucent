import { nonDeleted } from '../../../common/utils/prisma.helpers';
import { Injectable, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { ResultCode } from '../../../common/api-envelope';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class UserHealthContextGuardService {
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

    if (!allergy || allergy.userId !== userId) {
      this.throwUserNotFound();
    }
  }

  async ensureConditionOwnedByUser(
    userId: string,
    conditionId: string,
  ): Promise<void> {
    const condition = await this.prisma.userCondition.findUnique({
      where: { id: conditionId },
      select: { userId: true },
    });

    if (!condition || condition.userId !== userId) {
      this.throwUserNotFound();
    }
  }

  async ensureCurrentMedicineOwnedByUser(
    userId: string,
    medicineId: string,
  ): Promise<void> {
    const medicine = await this.prisma.userCurrentMedicine.findUnique({
      where: { id: medicineId },
      select: { userId: true },
    });

    if (!medicine || medicine.userId !== userId) {
      this.throwUserNotFound();
    }
  }

  private throwUserNotFound(): never {
    throw new NotFoundException({
      code: ResultCode.NOT_FOUND,
      message: this.i18n.t('auth.user_not_found'),
    });
  }
}
