import { Injectable, Logger } from '@nestjs/common';
import type { SuggestionCandidate } from '../types/candidate.types';
import type { RuleContext } from '../types/rule.types';
import { MedicationCollectorService } from './collectors/medication.service';
import { RecordCollectorService } from './collectors/record.service';
import { ProfileCollectorService } from './collectors/profile.service';
import { RegistryService } from './rules/registry.service';
import { SuppressionService } from './arbitration/suppression.service';
import {
  ArbitrationService,
  type ArbitrationResult,
} from './arbitration/service';
import { BaselineService } from './lifecycle/baseline.service';
import { SuggestionCacheService } from './cache/suggestion-cache.service';

/**
 * Output of the suggestion pipeline: arbitration result + degraded flag.
 */
export interface PipelineResult {
  /** Arbitrated candidates split into primary / secondary / observations. */
  arbitrationResult: ArbitrationResult;
  /** True when one or more rules threw an error during evaluation. */
  degraded: boolean;
}

/**
 * Encapsulates the first half of the suggestion engine:
 * collect signals → build rule context → run rules → suppress → arbitrate.
 *
 * Extracted from SuggestionService to reduce orchestrator complexity.
 */
@Injectable()
export class SuggestionPipelineService {
  private readonly logger = new Logger(SuggestionPipelineService.name);

  constructor(
    private readonly medicationCollector: MedicationCollectorService,
    private readonly recordCollector: RecordCollectorService,
    private readonly profileCollector: ProfileCollectorService,
    private readonly registry: RegistryService,
    private readonly suppression: SuppressionService,
    private readonly arbitration: ArbitrationService,
    private readonly baseline: BaselineService,
    private readonly cache: SuggestionCacheService,
  ) {}

  /**
   * Runs the full pipeline: collect → rules → suppress → arbitrate.
   *
   * Uses signal and baseline caches to avoid redundant queries on repeat
   * invocations within the same cache TTL window.
   */
  async run(userId: string, targetDate: string): Promise<PipelineResult> {
    // 1. Collect signals (use signal cache if available)
    let allSignals = await this.cache.getSignals(userId, targetDate);
    if (allSignals == null) {
      const [medicationSignals, recordSignals, profileSignals] =
        await Promise.all([
          this.medicationCollector.collect(userId, targetDate),
          this.recordCollector.collect(userId, targetDate),
          this.profileCollector.collect(userId, targetDate),
        ]);

      allSignals = [...medicationSignals, ...recordSignals, ...profileSignals];

      await this.cache.setSignals(userId, targetDate, allSignals);
    }

    // 2. Build rule context (use baseline cache if available)
    let baselineStatus = await this.cache.getBaselineStatus(userId);
    if (baselineStatus == null) {
      baselineStatus = await this.baseline.getBaselineStatus(userId);
      await this.cache.setBaselineStatus(userId, baselineStatus);
    }
    const context: RuleContext = {
      userId,
      date: targetDate,
      timeOfDay: RecordCollectorService.getTimeOfDay(),
      baselineStatus,
    };

    // 3. Run all rules
    const candidates: SuggestionCandidate[] = [];
    let degraded = false;
    for (const rule of this.registry.getAll()) {
      if (rule.isBaselineRequired && rule.baselineDimensions != null) {
        const allReady = rule.baselineDimensions.every(
          (dim) => baselineStatus.get(dim) === true,
        );
        if (!allReady) {
          continue;
        }
      }

      try {
        const candidate = rule.match(allSignals, context);
        if (candidate != null) {
          candidates.push(candidate);
        }
      } catch (error) {
        degraded = true;
        this.logger.error(
          `Rule ${rule.ruleId} threw an error: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    // 4. Filter & adjust candidates via feedback-driven suppression
    const { candidates: adjustedCandidates } =
      await this.suppression.filterAndAdjust(userId, candidates);

    // 5. Arbitrate
    const arbitrationResult = this.arbitration.arbitrate(adjustedCandidates);

    return { arbitrationResult, degraded };
  }
}
