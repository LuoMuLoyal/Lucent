import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../../prisma/prisma.service';
import { calculateAge } from '../../../common/utils/date-time.utils';
import type {
  ClinicSummaryDto,
  ClinicSummaryProfileDto,
  ClinicSummaryAllergyDto,
  ClinicSummaryConditionDto,
  ClinicSummaryMedicineDto,
  ClinicSummaryShareResponseDto,
} from '../dto/clinic-summary-response.dto';
import { ClinicSummaryPdfService } from './clinic-summary-pdf.service';

const SHARE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SHARE_KEY_PREFIX = 'clinic-share:';
const DATA_RANGE = 'last_30_days';

@Injectable()
export class ClinicSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly pdfService: ClinicSummaryPdfService,
  ) {}

  async buildClinicSummary(userId: string): Promise<ClinicSummaryDto> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        profile: {
          select: { birthDate: true, sexAtBirth: true, bloodType: true },
        },
        allergies: {
          where: { isActive: true },
          select: { label: true, reaction: true, severity: true },
          orderBy: { label: 'asc' },
        },
        conditions: {
          where: { status: 'active' },
          select: { label: true, status: true, diagnosedAt: true },
          orderBy: { label: 'asc' },
        },
        currentMedicines: {
          where: { isCurrent: true },
          select: { displayName: true, doseText: true },
          orderBy: { displayName: 'asc' },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const profile = this.deidentifyProfile(user);
    const allergies = user.allergies.map(
      (a) =>
        ({
          label: a.label,
          reaction: a.reaction,
          severity: a.severity,
        }) satisfies ClinicSummaryAllergyDto,
    );
    const conditions = user.conditions.map(
      (c) =>
        ({
          label: c.label,
          status: c.status,
          diagnosedYear: c.diagnosedAt?.getFullYear() ?? null,
        }) satisfies ClinicSummaryConditionDto,
    );
    const currentMedicines = user.currentMedicines.map(
      (m) =>
        ({
          displayName: m.displayName,
          doseText: m.doseText,
        }) satisfies ClinicSummaryMedicineDto,
    );

    return {
      generatedAt: new Date().toISOString(),
      dataRange: DATA_RANGE,
      profile,
      allergies,
      conditions,
      currentMedicines,
      disclaimer:
        '此摘要基于用户自述健康数据生成，仅供参考，不能替代专业医疗诊断。用药详情以实际药品说明书为准。',
    };
  }

  async createShareLink(
    userId: string,
  ): Promise<ClinicSummaryShareResponseDto> {
    const summary = await this.buildClinicSummary(userId);
    const token = randomBytes(16).toString('hex');
    const key = `${SHARE_KEY_PREFIX}${token}`;

    await this.cacheManager.set(key, summary, SHARE_TTL_MS);

    // Derive public base URL from env, fallback to localhost
    const baseUrl =
      process.env['PUBLIC_BASE_URL']?.trim() || 'http://localhost:3000';

    return {
      shareUrl: `${baseUrl}/api/v1/reports/clinic-summary/shared/${token}`,
      expiresAt: new Date(Date.now() + SHARE_TTL_MS).toISOString(),
    };
  }

  async getSharedSummary(token: string): Promise<ClinicSummaryDto | null> {
    const key = `${SHARE_KEY_PREFIX}${token}`;
    const cached = await this.cacheManager.get<ClinicSummaryDto>(key);
    return cached ?? null;
  }

  async exportPdf(userId: string, locale: string): Promise<Buffer> {
    const summary = await this.buildClinicSummary(userId);
    return this.pdfService.buildPdf(summary, locale);
  }

  async exportSharedPdf(token: string, locale: string): Promise<Buffer | null> {
    const summary = await this.getSharedSummary(token);
    if (!summary) return null;
    return this.pdfService.buildPdf(summary, locale);
  }

  // ── De-identification ──────────────────────────────────────

  private deidentifyProfile(user: {
    nickname: string | null;
    profile: {
      birthDate: Date | null;
      sexAtBirth: string | null;
      bloodType: string | null;
    } | null;
  }): ClinicSummaryProfileDto {
    const p = user.profile;

    return {
      nickname: this.maskName(user.nickname),
      age: p?.birthDate ? calculateAge(p.birthDate) : null,
      sexAtBirth: p?.sexAtBirth ?? null,
      bloodType: p?.bloodType ?? null,
    };
  }

  private maskName(name: string | null): string {
    if (!name) return '匿名用户';
    if (name.length <= 1) return name;
    return name.charAt(0) + '**';
  }
}
