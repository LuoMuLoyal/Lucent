import { Injectable } from '@nestjs/common';
import type {
  MedicineRiskFindingDto,
  MedicineRiskCoverageIssueDto,
  MedicineRedFlagDto,
  MedicineRiskSeverity,
  MedicineRiskLevel,
} from '../../dto/risk/risk-check-response.dto';
import {
  type MedicineDetailWrapper,
  getAllSourceIngredientTokens,
  getCanonicalIngredientKeys,
  getDisplayName,
  getDetailJson,
  getDrugbankIds,
  getDrugbankInteractionTargets,
  getDrugbankSynonymTokens,
  normalizeToken,
  expandCanonicalIngredientTokens,
  asNonEmptyString,
  firstNonEmpty,
  duplicateIngredientEvidence,
} from '../../utils/ingredient-canonicalization';
import {
  type AllergyRecord,
  inferredAllergySeverity,
  isSevereAllergy,
} from '../../utils/allergy-severity';

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

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class RiskDetectionService {
  /**
   * Runs the full static risk detection pipeline over a set of medicine details.
   *
   * @param details - Resolved medicine detail wrappers (eligible + fetched)
   * @param activeAllergies - User's active allergy records
   * @param uncoveredItems - Current medicines that could not be resolved to a detail
   * @returns Findings, coverage issues, red flags, and overall risk score/level
   */
  evaluateStaticRisk(
    details: MedicineDetailWrapper[],
    activeAllergies: AllergyRecord[],
    uncoveredItems: Array<{
      id: string;
      source: string;
      sourceRefId: string | null;
      displayName: string;
    }>,
  ): {
    findings: MedicineRiskFindingDto[];
    coverageIssues: MedicineRiskCoverageIssueDto[];
    redFlags: MedicineRedFlagDto[];
    riskScore: number;
    riskLevel: MedicineRiskLevel;
  } {
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

    const coverageIssues = uncoveredItems.map((item) =>
      this.coverageIssueFor(item),
    );

    const redFlags = this.evaluateRedFlags(
      activeAllergies,
      findings,
      coverageIssues,
    );

    const riskScore = calculateRiskScore(findings, coverageIssues, redFlags);
    const riskLevel = scoreToLevel(riskScore);

    return { findings, coverageIssues, redFlags, riskScore, riskLevel };
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
}
