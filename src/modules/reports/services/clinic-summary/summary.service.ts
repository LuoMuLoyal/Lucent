import { randomBytes, createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../../../../prisma';
import { calculateAge, nowIsoString } from '../../../../common';
import { ConfigKey } from '../../../../config/config-keys.enum';
import type {
  ClinicSummaryDto,
  ClinicSummaryProfileDto,
  ClinicSummaryAllergyDto,
  ClinicSummaryConditionDto,
  ClinicSummaryMedicineDto,
  ClinicSummaryShareResponseDto,
} from '../../dto/clinic-summary-response.dto';
import { ClinicSummaryPdfService } from './pdf.service';

const SHARE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SHARE_KEY_PREFIX = 'clinic-share:';
const DATA_RANGE = 'last_30_days';

@Injectable()
export class ClinicSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly pdfService: ClinicSummaryPdfService,
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  async buildClinicSummary(
    userId: string,
    locale: string = 'en',
  ): Promise<ClinicSummaryDto> {
    const user = await this.prisma.user.findFirstOrThrow({
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

    const profile = this.deidentifyProfile(user, locale);
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
      generatedAt: nowIsoString(),
      dataRange: DATA_RANGE,
      profile,
      allergies,
      conditions,
      currentMedicines,
      disclaimer: this.i18n.t('reports-clinic-summary.disclaimer', {
        lang: locale,
      }),
    };
  }

  async createShareLink(
    userId: string,
    locale: string = 'en',
  ): Promise<ClinicSummaryShareResponseDto> {
    const summary = await this.buildClinicSummary(userId, locale);
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const key = `${SHARE_KEY_PREFIX}${tokenHash}`;

    await this.cacheManager.set(key, summary, SHARE_TTL_MS);

    const appConfig = this.configService.get<{ publicBaseUrl: string }>(
      ConfigKey.App,
    );
    const baseUrl = appConfig?.publicBaseUrl ?? 'http://localhost:3000';

    return {
      shareUrl: `${baseUrl}/api/v1/reports/clinic-summary/shared/${token}`,
      expiresAt: new Date(Date.now() + SHARE_TTL_MS).toISOString(),
    };
  }

  async getSharedSummary(token: string): Promise<ClinicSummaryDto | null> {
    const tokenHash = this.hashToken(token);
    const key = `${SHARE_KEY_PREFIX}${tokenHash}`;
    const cached = await this.cacheManager.get<ClinicSummaryDto>(key);
    return cached ?? null;
  }

  async exportPdf(userId: string, locale: string): Promise<Buffer> {
    const summary = await this.buildClinicSummary(userId, locale);
    return this.pdfService.buildPdf(summary, locale);
  }

  async exportSharedPdf(token: string, locale: string): Promise<Buffer | null> {
    const summary = await this.getSharedSummary(token);
    if (!summary) return null;
    return this.pdfService.buildPdf(summary, locale);
  }

  // ── De-identification ──────────────────────────────────────

  private deidentifyProfile(
    user: {
      nickname: string | null;
      profile: {
        birthDate: Date | null;
        sexAtBirth: string | null;
        bloodType: string | null;
      } | null;
    },
    locale: string,
  ): ClinicSummaryProfileDto {
    const p = user.profile;

    return {
      nickname: this.maskName(user.nickname, locale),
      age: p?.birthDate ? calculateAge(p.birthDate) : null,
      sexAtBirth: p?.sexAtBirth ?? null,
      bloodType: p?.bloodType ?? null,
    };
  }

  private maskName(name: string | null, locale: string): string {
    if (!name)
      return this.i18n.t('reports-clinic-summary.anonymous_name', {
        lang: locale,
      });
    if (name.length <= 1) return name;
    return name.charAt(0) + '**';
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
