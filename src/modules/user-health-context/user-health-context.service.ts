import { Injectable, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { MedicineSource, Prisma } from '../../generated/prisma/client';
import { ResultCode } from '../../common/api-envelope';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateCurrentMedicineDto,
  CreateHealthContextAllergyDto,
  CreateHealthContextConditionDto,
  HealthContextResponseData,
  UpdateCurrentMedicineDto,
  UpdateHealthContextAllergyDto,
  UpdateHealthContextConditionDto,
  UpdateHealthContextProfileDto,
} from './dto';
import { UserHealthContextGuardService } from './guards/user-health-context-guard.service';
import { UserHealthContextMapperService } from './services/user-health-context-mapper.service';
import { UserHealthContextProfileWriteService } from './services/user-health-context-profile-write.service';
import { userHealthContextInclude } from './types/user-health-context.types';

@Injectable()
export class UserHealthContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
    private readonly guardService: UserHealthContextGuardService,
    private readonly mapperService: UserHealthContextMapperService,
    private readonly profileWriteService: UserHealthContextProfileWriteService,
  ) {}

  async getForUser(userId: string): Promise<HealthContextResponseData> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
      include: userHealthContextInclude,
    });

    if (!user) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: this.i18n.t('auth.user_not_found'),
      });
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

  // ── Allergy write methods ──

  async createAllergy(
    userId: string,
    dto: CreateHealthContextAllergyDto,
  ): Promise<HealthContextResponseData> {
    await this.guardService.ensureActiveUserExists(userId);

    await this.prisma.userAllergy.create({
      data: {
        userId,
        kind: dto.kind,
        label: dto.label.trim(),
        reaction: dto.reaction?.trim() ?? null,
        severity: dto.severity ?? null,
        note: dto.note?.trim() ?? null,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : null,
      },
    });

    return this.getForUser(userId);
  }

  async updateAllergy(
    userId: string,
    allergyId: string,
    dto: UpdateHealthContextAllergyDto,
  ): Promise<HealthContextResponseData> {
    await this.guardService.ensureAllergyOwnedByUser(userId, allergyId);

    const data: Prisma.UserAllergyUpdateInput = {};

    if (dto.kind !== undefined) {
      data.kind = dto.kind;
    }
    if (dto.label !== undefined) {
      data.label = dto.label.trim();
    }
    if (dto.reaction !== undefined) {
      data.reaction = dto.reaction?.trim() ?? null;
    }
    if (dto.severity !== undefined) {
      data.severity = dto.severity;
    }
    if (dto.note !== undefined) {
      data.note = dto.note?.trim() ?? null;
    }
    if (dto.recordedAt !== undefined) {
      data.recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : null;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    await this.prisma.userAllergy.update({
      where: { id: allergyId },
      data,
    });

    return this.getForUser(userId);
  }

  async deleteAllergy(
    userId: string,
    allergyId: string,
  ): Promise<HealthContextResponseData> {
    await this.guardService.ensureAllergyOwnedByUser(userId, allergyId);

    await this.prisma.userAllergy.update({
      where: { id: allergyId },
      data: { isActive: false },
    });

    return this.getForUser(userId);
  }

  // ── Condition write methods ──

  async createCondition(
    userId: string,
    dto: CreateHealthContextConditionDto,
  ): Promise<HealthContextResponseData> {
    await this.guardService.ensureActiveUserExists(userId);

    const createData: Prisma.UserConditionCreateInput = {
      user: { connect: { id: userId } },
      label: dto.label.trim(),
      diagnosedAt: this.mapperService.dateOnlyStringToUtcDate(
        dto.diagnosedAt ?? null,
      ),
      note: dto.note?.trim() ?? null,
    };

    if (dto.status !== undefined) {
      createData.status = dto.status;
    }

    await this.prisma.userCondition.create({ data: createData });

    return this.getForUser(userId);
  }

  async updateCondition(
    userId: string,
    conditionId: string,
    dto: UpdateHealthContextConditionDto,
  ): Promise<HealthContextResponseData> {
    await this.guardService.ensureConditionOwnedByUser(userId, conditionId);

    const data: Prisma.UserConditionUpdateInput = {};

    if (dto.label !== undefined) {
      data.label = dto.label.trim();
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    if (dto.diagnosedAt !== undefined) {
      data.diagnosedAt = this.mapperService.dateOnlyStringToUtcDate(
        dto.diagnosedAt,
      );
    }
    if (dto.note !== undefined) {
      data.note = dto.note?.trim() ?? null;
    }

    await this.prisma.userCondition.update({
      where: { id: conditionId },
      data,
    });

    return this.getForUser(userId);
  }

  async deleteCondition(
    userId: string,
    conditionId: string,
  ): Promise<HealthContextResponseData> {
    await this.guardService.ensureConditionOwnedByUser(userId, conditionId);

    const resolvedAt = new Date();
    const resolvedDate = this.mapperService.toUtcDateOnly(resolvedAt);

    // Only set resolvedAt when it is missing.
    const current = await this.prisma.userCondition.findUnique({
      where: { id: conditionId },
      select: { resolvedAt: true },
    });

    await this.prisma.userCondition.update({
      where: { id: conditionId },
      data: {
        status: 'resolved',
        resolvedAt: current?.resolvedAt ?? resolvedDate,
      },
    });

    return this.getForUser(userId);
  }

  // ── Current medicine write methods ──

  async createCurrentMedicine(
    userId: string,
    dto: CreateCurrentMedicineDto,
  ): Promise<HealthContextResponseData> {
    await this.guardService.ensureActiveUserExists(userId);

    const sourceRefId =
      dto.source === MedicineSource.manual ? null : (dto.sourceRefId ?? null);

    await this.prisma.userCurrentMedicine.create({
      data: {
        userId,
        source: dto.source,
        sourceRefId,
        displayName: dto.displayName.trim(),
        strengthText: dto.strengthText?.trim() ?? null,
        doseText: dto.doseText?.trim() ?? null,
        route: dto.route?.trim() ?? null,
        startedAt: this.mapperService.dateOnlyStringToUtcDate(
          dto.startedAt ?? null,
        ),
        endedAt: this.mapperService.dateOnlyStringToUtcDate(
          dto.endedAt ?? null,
        ),
        note: dto.note?.trim() ?? null,
      },
    });

    return this.getForUser(userId);
  }

  async updateCurrentMedicine(
    userId: string,
    medicineId: string,
    dto: UpdateCurrentMedicineDto,
  ): Promise<HealthContextResponseData> {
    await this.guardService.ensureCurrentMedicineOwnedByUser(
      userId,
      medicineId,
    );

    const data: Prisma.UserCurrentMedicineUpdateInput = {};

    if (dto.source !== undefined) {
      data.source = dto.source;
    }
    if (dto.sourceRefId !== undefined) {
      data.sourceRefId = dto.sourceRefId?.trim() ?? null;
    }
    if (dto.displayName !== undefined) {
      data.displayName = dto.displayName.trim();
    }
    if (dto.strengthText !== undefined) {
      data.strengthText = dto.strengthText?.trim() ?? null;
    }
    if (dto.doseText !== undefined) {
      data.doseText = dto.doseText?.trim() ?? null;
    }
    if (dto.route !== undefined) {
      data.route = dto.route?.trim() ?? null;
    }
    if (dto.startedAt !== undefined) {
      data.startedAt = this.mapperService.dateOnlyStringToUtcDate(
        dto.startedAt,
      );
    }
    if (dto.endedAt !== undefined) {
      data.endedAt = this.mapperService.dateOnlyStringToUtcDate(dto.endedAt);
    }
    if (dto.note !== undefined) {
      data.note = dto.note?.trim() ?? null;
    }
    if (dto.isCurrent !== undefined) {
      data.isCurrent = dto.isCurrent;
    }

    await this.prisma.userCurrentMedicine.update({
      where: { id: medicineId },
      data,
    });

    return this.getForUser(userId);
  }

  async deleteCurrentMedicine(
    userId: string,
    medicineId: string,
  ): Promise<HealthContextResponseData> {
    await this.guardService.ensureCurrentMedicineOwnedByUser(
      userId,
      medicineId,
    );

    const endedAt = new Date();
    const endedDate = this.mapperService.toUtcDateOnly(endedAt);

    // Only set endedAt when it is missing.
    const current = await this.prisma.userCurrentMedicine.findUnique({
      where: { id: medicineId },
      select: { endedAt: true },
    });

    await this.prisma.userCurrentMedicine.update({
      where: { id: medicineId },
      data: {
        isCurrent: false,
        endedAt: current?.endedAt ?? endedDate,
      },
    });

    return this.getForUser(userId);
  }
}
