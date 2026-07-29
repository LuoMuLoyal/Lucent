import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma';
import { MedicinesService } from '../medicines.service';
import { nonDeleted, formatDateOnly } from '../../../../common';
import type { MedicineRiskCheckResponseDto } from '../../dto/risk/risk-check-response.dto';
import type { MedicineRiskLlmContext } from '../../prompts/risk-check.prompt';
import {
  asNonEmptyString,
  getDetailJson,
} from '../../utils/ingredient-canonicalization';

@Injectable()
export class RiskContextBuilderService {
  private readonly logger = new Logger(RiskContextBuilderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly medicinesService: MedicinesService,
  ) {}

  async buildLlmContext(
    userId: string,
    staticResult: MedicineRiskCheckResponseDto,
  ): Promise<MedicineRiskLlmContext> {
    const [user, reminders] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: userId, ...nonDeleted },
        include: {
          allergies: {
            where: { isActive: true },
            orderBy: { updatedAt: 'desc' },
          },
          conditions: {
            where: { status: 'active' },
            orderBy: { updatedAt: 'desc' },
          },
          currentMedicines: {
            where: { isCurrent: true },
            orderBy: { updatedAt: 'desc' },
          },
        },
      }),
      this.prisma.userMedicineReminder.findMany({
        where: { userId, isActive: true, ...nonDeleted },
        orderBy: [{ scheduledHour: 'asc' }, { scheduledMinute: 'asc' }],
      }),
    ]);

    const medicines: MedicineRiskLlmContext['medicines'] = [];
    if (user != null) {
      const eligibleItems = user.currentMedicines.flatMap((item) => {
        const source = item.source;
        const sourceRefId = item.sourceRefId?.trim();
        if (
          (source === 'cn' || source === 'drugbank') &&
          sourceRefId != null &&
          sourceRefId !== ''
        ) {
          return [{ item, source, sourceRefId }];
        }
        return [];
      });

      const llmDetailResults = await Promise.allSettled(
        eligibleItems.map(async ({ item, source, sourceRefId }) => {
          const detail = await this.medicinesService.getDetailWithCache(
            sourceRefId,
            { source },
            false,
          );
          return { item, detail, source };
        }),
      );

      for (const result of llmDetailResults) {
        if (result.status === 'rejected') {
          this.logger.warn(
            `LLM context: failed to fetch detail: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          );
          continue;
        }
        const { item, detail, source } = result.value;
        const json = getDetailJson(detail);
        const drugInteractions = Array.isArray(json['drugInteractions'])
          ? (json['drugInteractions'] as Array<Record<string, unknown>>)
              .filter(
                (d) =>
                  typeof d['drugbankId'] === 'string' &&
                  typeof d['description'] === 'string',
              )
              .map((d) => ({
                target: String(d['drugbankId']),
                description: String(d['description']),
              }))
          : [];
        const ingredients = asNonEmptyString(json['ingredients']);
        const contraindications = asNonEmptyString(json['contraindications']);
        const precautions = asNonEmptyString(json['precautions']);
        const foodInteractions = Array.isArray(json['foodInteractions'])
          ? (json['foodInteractions'] as unknown[]).filter(
              (v): v is string => typeof v === 'string',
            )
          : null;
        const startedAt = item.startedAt
          ? formatDateOnly(item.startedAt)
          : null;
        medicines.push({
          name: item.displayName.trim() !== '' ? item.displayName : detail.name,
          source,
          ...(ingredients != null ? { ingredients } : {}),
          ...(contraindications != null ? { contraindications } : {}),
          ...(precautions != null ? { precautions } : {}),
          ...(foodInteractions != null ? { foodInteractions } : {}),
          ...(drugInteractions.length > 0 ? { drugInteractions } : {}),
          ...(startedAt != null ? { startedAt } : {}),
        });
      }
    }

    const allergies: MedicineRiskLlmContext['allergies'] =
      user?.allergies.map((a) => {
        const reaction = a.reaction;
        return {
          label: a.label,
          severity: a.severity ?? 'unknown',
          ...(reaction != null ? { reaction } : {}),
        };
      }) ?? [];

    const conditions: MedicineRiskLlmContext['conditions'] =
      user?.conditions.map((c) => ({
        label: c.label,
        status: c.status,
      })) ?? [];

    const reminderMedicines = user?.currentMedicines ?? [];
    const remindersCtx: MedicineRiskLlmContext['reminders'] = reminders
      .map((r) => {
        const medicine = reminderMedicines.find(
          (m) => m.id === r.currentMedicineId,
        );
        if (medicine == null) return null;
        const daysOfWeek = Array.isArray(r.daysOfWeek)
          ? (r.daysOfWeek as unknown[]).filter(
              (d): d is number => typeof d === 'number',
            )
          : undefined;
        const startDate = r.startDate ? formatDateOnly(r.startDate) : null;
        const endDate = r.endDate ? formatDateOnly(r.endDate) : null;
        return {
          medicineName: medicine.displayName,
          scheduledHour: r.scheduledHour,
          scheduledMinute: r.scheduledMinute,
          ...(daysOfWeek != null && daysOfWeek.length > 0
            ? { daysOfWeek }
            : {}),
          ...(startDate != null ? { startDate } : {}),
          ...(endDate != null ? { endDate } : {}),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);

    const staticFindings = staticResult.findings.map((f) => ({
      type: f.type,
      severity: f.severity,
      description: [
        f.primaryMedicineName,
        f.secondaryMedicineName != null ? ` + ${f.secondaryMedicineName}` : '',
        f.relatedLabel != null ? ` (allergen: ${f.relatedLabel})` : '',
        f.evidence != null ? ` — ${f.evidence}` : '',
      ].join(''),
    }));

    return {
      medicines,
      allergies,
      conditions,
      reminders: remindersCtx,
      staticFindings,
    };
  }
}
