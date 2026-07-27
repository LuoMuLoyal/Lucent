import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../../prisma';
import { MedicinesService } from './medicines.service';
import { MedicineRiskLlmGeneratorService } from './medicine-risk-llm-generator.service';
import { nonDeleted, toInputJsonValue, formatDateOnly } from '../../../common';
import type {
  MedicineRiskCheckResponseDto,
  MedicineRiskCheckRecordDto,
  MedicineRiskFindingDto,
  MedicineRiskCoverageIssueDto,
  MedicineRedFlagDto,
  MedicineRiskLevel,
  MedicineRiskSeverity,
} from '../dto/risk-check-response.dto';
import type { MedicineDetailDataDto } from '../dto/medicine-detail.dto';
import type { MedicineRiskLlmContext } from '../prompts/risk-check.prompt';
import type { MedicineRiskLlmOutput } from '../schemas/risk-check.schema';

const RISK_CHECK_CACHE_KEY_PREFIX = 'medicines:risk-check';
const RISK_CHECK_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Ingredient canonicalization (migrated from client) ───────────────────

const canonicalIngredientVariants: Record<string, Set<string>> = {
  acetaminophen: new Set([
    'acetaminophen',
    'paracetamol',
    '对乙酰氨基酚',
    '扑热息痛',
  ]),
  aspirin: new Set([
    'aspirin',
    'acetylsalicylicacid',
    '乙酰水杨酸',
    '阿司匹林',
  ]),
  ibuprofen: new Set(['ibuprofen', '布洛芬']),
  amoxicillin: new Set(['amoxicillin', '阿莫西林']),
  penicillin: new Set(['penicillin', '青霉素', '盘尼西林']),
  cephalosporin: new Set(['cephalosporin', '头孢', '先锋霉素']),
  sulfa: new Set(['sulfa', 'sulfonamide', '磺胺']),
  metformin: new Set(['metformin', '二甲双胍']),
  loratadine: new Set(['loratadine', '氯雷他定']),
  cetirizine: new Set(['cetirizine', '西替利嗪']),
  diphenhydramine: new Set(['diphenhydramine', '苯海拉明']),
  chlorpheniramine: new Set(['chlorpheniramine', '氯苯那敏', '扑尔敏']),
  pseudoephedrine: new Set(['pseudoephedrine', '伪麻黄碱']),
  dextromethorphan: new Set(['dextromethorphan', '右美沙芬']),
  guaifenesin: new Set(['guaifenesin', '愈创甘油醚']),
};

function normalizeToken(value: string): string {
  return value.toLowerCase().replaceAll(/\s+/g, '');
}

function asNonEmptyString(value: unknown): string | null {
  const text = value?.toString().trim();
  if (text == null || text === '') return null;
  return text;
}

function firstNonEmpty(
  a: string | null,
  b: string | null,
  c: string | null,
): string | null {
  if (a != null && a !== '') return a;
  if (b != null && b !== '') return b;
  if (c != null && c !== '') return c;
  return null;
}

function extractIngredientTokens(value: string): Set<string> {
  const normalized = value
    .replaceAll('（', '(')
    .replaceAll('）', ')')
    .replaceAll('；', ';')
    .replaceAll('，', ',')
    .replaceAll('、', ',')
    .replaceAll('+', ',')
    .replaceAll(' and ', ',')
    .replaceAll(' AND ', ',');
  const parts = normalized.split(/[;,/\n\r+|]/);
  return new Set(
    [...parts].map(cleanIngredientToken).filter((v): v is string => v != null),
  );
}

function cleanIngredientToken(raw: string): string | null {
  const withoutParens = raw.replaceAll(/\([^)]*\)/g, ' ');
  const withoutStrength = withoutParens.replaceAll(
    /\b\d+(\.\d+)?\s*(mg|g|ml|mcg|iu|%|片|粒|袋|支|丸)\b/gi,
    ' ',
  );
  const n = normalizeToken(
    withoutStrength.replaceAll(/[·.-]/g, ' ').replaceAll(/\s+/g, ' ').trim(),
  );
  if (n === '' || n.length <= 1) return null;
  return n;
}

function canonicalIngredientKeysFor(tokens: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const token of tokens) {
    let matched = false;
    for (const [key, variants] of Object.entries(canonicalIngredientVariants)) {
      const normalizedVariants = new Set([...variants].map(normalizeToken));
      if (normalizedVariants.has(token)) {
        result.add(key);
        matched = true;
        break;
      }
    }
    if (!matched) {
      result.add(token);
    }
  }
  return result;
}

function expandCanonicalIngredientTokens(tokens: Set<string>): Set<string> {
  const result = new Set(tokens);
  for (const variants of Object.values(canonicalIngredientVariants)) {
    const normalizedVariants = new Set([...variants].map(normalizeToken));
    const intersection = [...normalizedVariants].filter((v) => tokens.has(v));
    if (intersection.length > 0) {
      for (const v of normalizedVariants) {
        result.add(v);
      }
    }
  }
  return result;
}

function duplicateIngredientEvidence(sharedTokens: Set<string>): string {
  return [...sharedTokens].sort().join(' / ');
}

// ─── Allergy severity inference (migrated from client) ─────────────────────

const anaphylaxisKeywords = new Set([
  'anaphylaxis',
  'anaphylactic',
  '过敏性休克',
  '严重过敏',
  '重度过敏',
  '休克',
]);

interface AllergyRecord {
  label: string;
  reaction: string | null;
  severity: string | null;
  isActive: boolean;
}

function inferredAllergySeverity(allergy: AllergyRecord): string {
  const reaction = (allergy.reaction ?? '').toLowerCase();
  if ([...anaphylaxisKeywords].some((kw) => reaction.includes(kw))) {
    return 'severe';
  }
  const severity = allergy.severity?.toLowerCase().trim();
  if (severity == null || severity === '' || severity === 'unknown') {
    return 'unknown';
  }
  return severity;
}

function isSevereAllergy(allergy: AllergyRecord): boolean {
  return inferredAllergySeverity(allergy) === 'severe';
}

// ─── Medicine detail wrapper (migrated from client) ────────────────────────

interface MedicineDetailWrapper {
  item: {
    id: string;
    source: string;
    sourceRefId: string | null;
    displayName: string;
    startedAt: Date | null;
  };
  detail: MedicineDetailDataDto;
}

function getDisplayName(medicine: MedicineDetailWrapper): string {
  const name = medicine.item.displayName.trim();
  return name !== '' ? name : medicine.detail.name;
}

function getDetailJson(detail: MedicineDetailDataDto): Record<string, unknown> {
  return detail.detail as unknown as Record<string, unknown>;
}

function getNormalizedIngredientTokens(
  medicine: MedicineDetailWrapper,
): Set<string> {
  const json = getDetailJson(medicine.detail);
  if (medicine.item.source === 'cn') {
    const ingredients = asNonEmptyString(json['ingredients']);
    if (ingredients == null) return new Set();
    return extractIngredientTokens(ingredients);
  }
  if (medicine.item.source === 'drugbank') {
    return getDrugbankSynonymTokens(medicine);
  }
  return new Set();
}

function getAllSourceIngredientTokens(
  medicine: MedicineDetailWrapper,
): Set<string> {
  const tokens = new Set<string>();
  for (const t of getCanonicalIngredientKeys(medicine)) {
    tokens.add(t);
  }
  tokens.add(normalizeToken(getDisplayName(medicine)));
  return tokens;
}

function getCanonicalIngredientKeys(
  medicine: MedicineDetailWrapper,
): Set<string> {
  return canonicalIngredientKeysFor(getNormalizedIngredientTokens(medicine));
}

function getDrugbankSynonymTokens(
  medicine: MedicineDetailWrapper,
): Set<string> {
  if (medicine.item.source !== 'drugbank') return new Set();
  const json = getDetailJson(medicine.detail);
  const names = medicine.detail.name.trim();
  const result = new Set<string>();
  if (names !== '') result.add(normalizeToken(names));
  const synonyms = (json['synonyms'] as unknown[] | undefined) ?? [];
  for (const synonym of synonyms) {
    const token = normalizeToken(String(synonym));
    if (token !== '') result.add(token);
  }
  return result;
}

function getDrugbankIds(medicine: MedicineDetailWrapper): Set<string> {
  if (medicine.item.source === 'drugbank') {
    const id = medicine.item.sourceRefId;
    if (id == null || id === '') return new Set();
    return new Set([id]);
  }
  if (medicine.item.source === 'cn') {
    const json = getDetailJson(medicine.detail);
    const value = json['drugbankIds'] as unknown[] | undefined;
    if (value != null) {
      return new Set(
        value
          .map((entry) => String(entry).trim())
          .filter((entry) => entry !== ''),
      );
    }
  }
  return new Set();
}

function getDrugbankInteractionTargets(
  medicine: MedicineDetailWrapper,
): Set<string> {
  if (medicine.item.source !== 'drugbank') return new Set();
  const json = getDetailJson(medicine.detail);
  const value = json['drugInteractions'];
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value
      .filter(
        (v): v is Record<string, unknown> => v != null && typeof v === 'object',
      )
      .map((entry) => entry['drugbankId']?.toString() ?? '')
      .map((v) => v.trim())
      .filter((v) => v !== ''),
  );
}

// ─── Risk Score calculation ─────────────────────────────────────────────────

function calculateRiskScore(
  findings: MedicineRiskFindingDto[],
  coverageIssues: MedicineRiskCoverageIssueDto[],
  redFlags: MedicineRedFlagDto[],
): number {
  let score = 0;
  for (const f of findings) {
    if (f.severity === 'high') score += 30;
    else if (f.severity === 'medium') score += 15;
    else score += 5;
  }
  score += coverageIssues.length * 3;
  for (const rf of redFlags) {
    if (rf.rule === 'severeAllergy') score += 40;
    else score += 10;
  }
  return Math.min(100, score);
}

function scoreToLevel(score: number): MedicineRiskLevel {
  if (score <= 10) return 'safe';
  if (score <= 40) return 'caution';
  if (score <= 70) return 'risk';
  return 'danger';
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class MedicineRiskCheckService {
  private readonly logger = new Logger(MedicineRiskCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly medicinesService: MedicinesService,
    private readonly llmGenerator: MedicineRiskLlmGeneratorService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────

  async getRecords(userId: string): Promise<{
    static: MedicineRiskCheckRecordDto | null;
    llm: MedicineRiskCheckRecordDto | null;
  }> {
    const cacheKey = this.buildRecordsCacheKey(userId);
    const cached = await this.cache.get<{
      static: MedicineRiskCheckRecordDto | null;
      llm: MedicineRiskCheckRecordDto | null;
    }>(cacheKey);
    if (cached != null) {
      return cached;
    }

    const records = await this.prisma.medicineRiskCheckRecord.findMany({
      where: { userId },
    });

    const result = {
      static: records.find((r) => r.checkType === 'static') ?? null,
      llm: records.find((r) => r.checkType === 'llm') ?? null,
    };

    const mapped = {
      static: result.static != null ? this.toDto(result.static) : null,
      llm: result.llm != null ? this.toDto(result.llm) : null,
    };

    await this.cache.set(cacheKey, mapped, RISK_CHECK_CACHE_TTL_MS);
    return mapped;
  }

  async runStaticCheck(userId: string): Promise<MedicineRiskCheckRecordDto> {
    const response = await this.evaluateStaticCheck(userId);
    return this.persistRecord(userId, 'static', response);
  }

  async runLlmCheck(userId: string): Promise<MedicineRiskCheckRecordDto> {
    if (!this.llmGenerator.hasAnalysisModel()) {
      throw new Error('LLM analysis model is not configured');
    }

    // 1. Run static check to get baseline findings
    const staticResult = await this.evaluateStaticCheck(userId);

    // 2. Build LLM context
    const llmContext = await this.buildLlmContext(userId, staticResult);

    // 3. Call LLM generator
    const llmOutput = await this.llmGenerator.generate(llmContext, {
      userIntro: '',
      tone: '',
      actionLabelHint: '',
      factsLabel: '',
    });

    // 4. Map LLM output to response DTO
    const response = this.mapLlmOutput(llmOutput, staticResult);

    // 5. Persist
    return this.persistRecord(userId, 'llm', response);
  }

  // ── LLM context building ──────────────────────────────────────────────

  private async buildLlmContext(
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
      for (const item of user.currentMedicines) {
        const source = item.source;
        const sourceRefId = item.sourceRefId?.trim();
        if (
          (source !== 'cn' && source !== 'drugbank') ||
          sourceRefId == null ||
          sourceRefId === ''
        ) {
          continue;
        }
        try {
          const detail = await this.medicinesService.getDetailWithCache(
            sourceRefId,
            { source },
            false,
          );
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
            name:
              item.displayName.trim() !== '' ? item.displayName : detail.name,
            source: source,
            ...(ingredients != null ? { ingredients } : {}),
            ...(contraindications != null ? { contraindications } : {}),
            ...(precautions != null ? { precautions } : {}),
            ...(foodInteractions != null ? { foodInteractions } : {}),
            ...(drugInteractions.length > 0 ? { drugInteractions } : {}),
            ...(startedAt != null ? { startedAt } : {}),
          });
        } catch (error) {
          this.logger.warn(
            `LLM context: failed to fetch detail for ${sourceRefId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
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

  private mapLlmOutput(
    llmOutput: MedicineRiskLlmOutput,
    staticResult: MedicineRiskCheckResponseDto,
  ): MedicineRiskCheckResponseDto {
    const findings: MedicineRiskFindingDto[] = llmOutput.findings.map((f) => ({
      type: f.type,
      severity: f.severity,
      context: 'none',
      primaryMedicineName: f.primaryMedicineName,
      ...(f.secondaryMedicineName != null
        ? { secondaryMedicineName: f.secondaryMedicineName }
        : {}),
      evidence: f.description,
      recommendation: f.recommendation,
    }));

    return {
      overallRiskLevel: llmOutput.riskLevel,
      overallRiskScore: llmOutput.riskScore,
      currentMedicineCount: staticResult.currentMedicineCount,
      checkedMedicineCount: staticResult.checkedMedicineCount,
      findings,
      coverageIssues: staticResult.coverageIssues,
      redFlags: staticResult.redFlags,
      ...(llmOutput.overallRecommendation !== ''
        ? { overallRecommendation: llmOutput.overallRecommendation }
        : {}),
    };
  }

  async markStale(userId: string): Promise<void> {
    await this.prisma.medicineRiskCheckRecord.updateMany({
      where: { userId },
      data: { stale: true },
    });
    // Delete Redis cache for records — next GET will re-read from DB
    const cacheKey = this.buildRecordsCacheKey(userId);
    await this.cache.del(cacheKey);
  }

  // ── Static check logic ──────────────────────────────────────────────────

  private async evaluateStaticCheck(
    userId: string,
  ): Promise<MedicineRiskCheckResponseDto> {
    // 1. Get health context directly from DB
    const user = await this.prisma.user.findFirst({
      where: { id: userId, ...nonDeleted },
      include: {
        allergies: {
          where: { isActive: true },
          orderBy: { updatedAt: 'desc' },
        },
        conditions: {
          orderBy: { updatedAt: 'desc' },
        },
        currentMedicines: {
          where: { isCurrent: true },
          orderBy: { updatedAt: 'desc' },
        },
      },
    });

    if (user == null) {
      return {
        overallRiskLevel: 'safe',
        overallRiskScore: 0,
        currentMedicineCount: 0,
        checkedMedicineCount: 0,
        findings: [],
        coverageIssues: [],
        redFlags: [],
      };
    }

    const activeAllergies = user.allergies;
    const currentMedicines = user.currentMedicines;

    // 2. Fetch medicine details for each current medicine
    const details: MedicineDetailWrapper[] = [];
    for (const item of currentMedicines) {
      const source = item.source;
      const sourceRefId = item.sourceRefId?.trim();
      if (
        (source !== 'cn' && source !== 'drugbank') ||
        sourceRefId == null ||
        sourceRefId === ''
      ) {
        continue;
      }

      try {
        const detail = await this.medicinesService.getDetailWithCache(
          sourceRefId,
          { source },
          false,
        );
        details.push({
          item: {
            id: item.id,
            source,
            sourceRefId,
            displayName: item.displayName,
            startedAt: item.startedAt,
          },
          detail,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to fetch medicine detail for ${sourceRefId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // 3. Run risk checking logic
    const findings: MedicineRiskFindingDto[] = [];

    for (const medicine of details) {
      findings.push(...this.allergyFindings(activeAllergies, medicine));
      findings.push(...this.foodInteractionFindings(medicine));
    }

    for (let i = 0; i < details.length; i++) {
      const current = details[i];
      if (current == null) continue;
      for (let j = i + 1; j < details.length; j++) {
        const other = details[j];
        if (other == null) continue;
        const interaction = this.pairInteractionFinding(current, other);
        if (interaction != null) findings.push(interaction);
        const duplicate = this.duplicateIngredientFinding(current, other);
        if (duplicate != null) findings.push(duplicate);
      }
    }

    // 4. Coverage issues
    const coverageIssues: MedicineRiskCoverageIssueDto[] = currentMedicines
      .filter((item) => !details.some((d) => d.item.id === item.id))
      .map((item) => this.coverageIssueFor(item));

    // 5. Red flags
    const redFlags = this.evaluateRedFlags(
      activeAllergies,
      findings,
      coverageIssues,
    );

    // 6. Risk score
    const riskScore = calculateRiskScore(findings, coverageIssues, redFlags);
    const riskLevel = scoreToLevel(riskScore);

    return {
      overallRiskLevel: riskLevel,
      overallRiskScore: riskScore,
      currentMedicineCount: currentMedicines.length,
      checkedMedicineCount: details.length,
      findings,
      coverageIssues,
      redFlags,
    };
  }

  // ── Allergy findings ───────────────────────────────────────────────────

  private allergyFindings(
    activeAllergies: AllergyRecord[],
    medicine: MedicineDetailWrapper,
  ): MedicineRiskFindingDto[] {
    if (activeAllergies.length === 0) return [];

    const ingredientTokens = getAllSourceIngredientTokens(medicine);
    const json = getDetailJson(medicine.detail);
    const haystacks = [
      getDisplayName(medicine),
      asNonEmptyString(json['ingredients']) ?? '',
      asNonEmptyString(json['contraindications']) ?? '',
      asNonEmptyString(json['precautions']) ?? '',
      ...getDrugbankSynonymTokens(medicine),
    ];
    const normalizedHaystack = normalizeToken(haystacks.join(' '));

    const findings: MedicineRiskFindingDto[] = [];
    for (const allergyItem of activeAllergies) {
      const rawLabel = allergyItem.label.trim();
      if (rawLabel === '') continue;
      const allergyToken = normalizeToken(rawLabel);
      if (allergyToken === '') continue;

      const matchTokens = expandCanonicalIngredientTokens(
        new Set([allergyToken]),
      );
      const matchedViaToken = [...matchTokens].some((t) =>
        ingredientTokens.has(t),
      );
      const matchedViaHaystack = [...matchTokens].some((t) =>
        normalizedHaystack.includes(t),
      );

      if (!matchedViaToken && !matchedViaHaystack) continue;

      const severity = this.allergyFindingSeverity(allergyItem);

      const evidence = firstNonEmpty(
        asNonEmptyString(json['contraindications']),
        asNonEmptyString(json['ingredients']),
        asNonEmptyString(json['precautions']),
      );
      findings.push({
        type: 'allergy',
        severity,
        context: 'none',
        primaryMedicineName: getDisplayName(medicine),
        relatedLabel: rawLabel,
        ...(evidence != null ? { evidence } : {}),
      });
    }

    return findings;
  }

  private allergyFindingSeverity(allergy: AllergyRecord): MedicineRiskSeverity {
    const severity = inferredAllergySeverity(allergy);
    switch (severity) {
      case 'severe':
        return 'high';
      case 'moderate':
        return 'medium';
      case 'mild':
        return 'info';
      default:
        return 'high';
    }
  }

  // ── Food interaction findings ──────────────────────────────────────────

  private foodInteractionFindings(
    medicine: MedicineDetailWrapper,
  ): MedicineRiskFindingDto[] {
    const findings: MedicineRiskFindingDto[] = [];
    const json = getDetailJson(medicine.detail);
    const interactions =
      (json['foodInteractions'] as unknown[] | undefined) ?? [];

    for (const interaction of interactions) {
      if (typeof interaction !== 'string') continue;
      const normalized = normalizeToken(interaction);

      if (normalized.includes('alcohol') || normalized.includes('酒')) {
        findings.push({
          type: 'foodInteraction',
          severity: 'medium',
          context: 'alcohol',
          primaryMedicineName: getDisplayName(medicine),
          evidence: interaction,
        });
      }

      if (
        normalized.includes('caffeine') ||
        normalized.includes('coffee') ||
        normalized.includes('tea') ||
        normalized.includes('咖啡') ||
        normalized.includes('浓茶')
      ) {
        findings.push({
          type: 'foodInteraction',
          severity: 'info',
          context: 'caffeine',
          primaryMedicineName: getDisplayName(medicine),
          evidence: interaction,
        });
      }
    }

    return findings;
  }

  // ── Pair interaction finding ───────────────────────────────────────────

  private pairInteractionFinding(
    current: MedicineDetailWrapper,
    other: MedicineDetailWrapper,
  ): MedicineRiskFindingDto | null {
    const currentTargets = getDrugbankInteractionTargets(current);
    const otherIds = getDrugbankIds(other);
    const overlappingIds = [...currentTargets].filter((id) => otherIds.has(id));

    if (overlappingIds.length > 0) {
      const targetId = overlappingIds[0];
      if (targetId == null) return null;
      const json = getDetailJson(current.detail);
      const evidence = this.interactionEvidenceFor(
        json['drugInteractions'],
        targetId,
      );
      return {
        type: 'interaction',
        severity: 'high',
        context: 'none',
        primaryMedicineName: getDisplayName(current),
        secondaryMedicineName: getDisplayName(other),
        ...(evidence != null ? { evidence } : {}),
      };
    }

    const otherTargets = getDrugbankInteractionTargets(other);
    const currentIds = getDrugbankIds(current);
    const reverseOverlapping = [...otherTargets].filter((id) =>
      currentIds.has(id),
    );

    if (reverseOverlapping.length > 0) {
      const targetId = reverseOverlapping[0];
      if (targetId == null) return null;
      const json = getDetailJson(other.detail);
      const evidence = this.interactionEvidenceFor(
        json['drugInteractions'],
        targetId,
      );
      return {
        type: 'interaction',
        severity: 'high',
        context: 'none',
        primaryMedicineName: getDisplayName(other),
        secondaryMedicineName: getDisplayName(current),
        ...(evidence != null ? { evidence } : {}),
      };
    }

    return null;
  }

  private interactionEvidenceFor(
    value: unknown,
    targetId: string,
  ): string | null {
    if (!Array.isArray(value)) return null;
    for (const item of value) {
      if (item == null || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const id = record['drugbankId']?.toString();
      if (id !== targetId) continue;
      return asNonEmptyString(record['description']);
    }
    return null;
  }

  // ── Duplicate ingredient finding ────────────────────────────────────────

  private duplicateIngredientFinding(
    current: MedicineDetailWrapper,
    other: MedicineDetailWrapper,
  ): MedicineRiskFindingDto | null {
    const currentTokens = getCanonicalIngredientKeys(current);
    const otherTokens = getCanonicalIngredientKeys(other);
    if (currentTokens.size === 0 || otherTokens.size === 0) return null;

    const sharedTokens = new Set(
      [...currentTokens].filter((t) => otherTokens.has(t)),
    );
    if (sharedTokens.size === 0) return null;

    return {
      type: 'duplicateIngredient',
      severity: 'medium',
      context: 'none',
      primaryMedicineName: getDisplayName(current),
      secondaryMedicineName: getDisplayName(other),
      evidence: duplicateIngredientEvidence(sharedTokens),
    };
  }

  // ── Coverage issue ──────────────────────────────────────────────────────

  private coverageIssueFor(item: {
    id: string;
    source: string;
    sourceRefId: string | null;
    displayName: string;
  }): MedicineRiskCoverageIssueDto {
    if (item.source === 'manual') {
      return {
        medicineName: item.displayName,
        reason: 'manualEntry',
      };
    }
    if (item.sourceRefId == null || item.sourceRefId.trim() === '') {
      return {
        medicineName: item.displayName,
        reason: 'missingSourceRef',
      };
    }
    return {
      medicineName: item.displayName,
      reason: 'detailUnavailable',
    };
  }

  // ── Red flag evaluation ─────────────────────────────────────────────────

  private evaluateRedFlags(
    activeAllergies: AllergyRecord[],
    findings: MedicineRiskFindingDto[],
    coverageIssues: MedicineRiskCoverageIssueDto[],
  ): MedicineRedFlagDto[] {
    const alerts: MedicineRedFlagDto[] = [];

    // Rule 1: Severe allergy match
    const severeAllergens = new Set(
      activeAllergies
        .filter((a) => a.isActive && isSevereAllergy(a))
        .map((a) => a.label.trim())
        .filter((l) => l !== ''),
    );

    if (severeAllergens.size > 0) {
      for (const f of findings) {
        if (
          f.type === 'allergy' &&
          f.relatedLabel != null &&
          severeAllergens.has(f.relatedLabel.trim())
        ) {
          alerts.push({
            rule: 'severeAllergy',
            primaryMedicineName: f.primaryMedicineName,
            relatedLabel: f.relatedLabel,
          });
        }
      }
    }

    // Rule 2: Information gap for high-risk profiles
    if (coverageIssues.length > 0 && severeAllergens.size > 0) {
      for (const issue of coverageIssues.slice(0, 2)) {
        alerts.push({
          rule: 'informationGap',
          primaryMedicineName: issue.medicineName,
        });
      }
    }

    return alerts;
  }

  // ── DB persistence ──────────────────────────────────────────────────────

  private async persistRecord(
    userId: string,
    checkType: 'static' | 'llm',
    response: MedicineRiskCheckResponseDto,
  ): Promise<MedicineRiskCheckRecordDto> {
    const record = await this.prisma.medicineRiskCheckRecord.upsert({
      where: { userId_checkType: { userId, checkType } },
      create: {
        userId,
        checkType,
        result: toInputJsonValue(response),
        riskScore: response.overallRiskScore,
        riskLevel: response.overallRiskLevel,
        stale: false,
      },
      update: {
        result: toInputJsonValue(response),
        riskScore: response.overallRiskScore,
        riskLevel: response.overallRiskLevel,
        stale: false,
      },
    });

    // Invalidate cache
    const cacheKey = this.buildRecordsCacheKey(userId);
    await this.cache.del(cacheKey);

    return this.toDto(record);
  }

  // ── Mapping ──────────────────────────────────────────────────────────────

  private toDto(record: {
    checkType: string;
    result: unknown;
    riskScore: number;
    riskLevel: string;
    stale: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): MedicineRiskCheckRecordDto {
    return {
      checkType: record.checkType as 'static' | 'llm',
      result: record.result as MedicineRiskCheckResponseDto,
      riskScore: record.riskScore,
      riskLevel: record.riskLevel as MedicineRiskLevel,
      stale: record.stale,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  // ── Cache keys ──────────────────────────────────────────────────────────

  private buildRecordsCacheKey(userId: string): string {
    return `${RISK_CHECK_CACHE_KEY_PREFIX}:records:${userId}`;
  }
}
