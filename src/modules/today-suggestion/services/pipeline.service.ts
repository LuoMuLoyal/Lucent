import { Injectable, Logger } from '@nestjs/common';
import type { SuggestionCandidate } from '../domain/suggestion/suggestion-candidate.js';
import type { RuleContext } from '../domain/rule/rule-definition.js';
import { MedicationCollectorService } from '../adapters/acl/collectors/medication.js';
import { RecordCollectorService } from '../adapters/acl/collectors/record.js';
import { ProfileCollectorService } from '../adapters/acl/collectors/profile.js';
import { HealthEventCollectorService } from '../adapters/acl/collectors/health-event.js';
import { RegistryService } from '../application/services/rule-registry.js';
import { FeedbackReadModel } from '../application/read_models/feedback-read.js';
import { arbitrate } from '../domain/policies/arbitration/arbiter.js';
import type { ArbitrationResult } from '../domain/policies/arbitration/arbiter.js';
import { suppressAndAdjust } from '../domain/policies/feedback/suppression.js';
import { BaselineService } from '../infrastructure/persistence/baseline.js';
import { SuggestionCacheService } from '../infrastructure/cache/suggestions.js';
import type { SuggestionSignal } from '../domain/signal/signal.js';

/**
 * Output of the suggestion pipeline: arbitration result + degraded flag.
 */
export interface PipelineResult {
  /** Arbitrated candidates split into primary / secondary / observations. */
  arbitrationResult: ArbitrationResult;
  /** True when one or more rules threw an error during evaluation. */
  degraded: boolean;
  /** Exact signal snapshot used for this recompute. */
  signals: SuggestionSignal[];
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
    private readonly healthEventCollector: HealthEventCollectorService,
    private readonly registry: RegistryService,
    private readonly feedbackRead: FeedbackReadModel,
    private readonly baseline: BaselineService,
    private readonly cache: SuggestionCacheService,
  ) {}

  /**
   * Pure suggestion computation entry: collect → rules → suppress → arbitrate.
   * It is invoked by the background recompute path, never by the GET path.
   *
   * Uses signal and baseline caches to avoid redundant queries on repeat
   * invocations within the same cache TTL window.
   */
  async run(userId: string, targetDate: string): Promise<PipelineResult> {
    // 1. Collect signals (use signal cache if available)
    let allSignals = await this.cache.getSignals(userId, targetDate);
    if (allSignals == null) {
      const [
        medicationSignals,
        recordSignals,
        profileSignals,
        healthEventSignals,
      ] = await Promise.all([
        this.medicationCollector.collect(userId, targetDate),
        this.recordCollector.collect(userId, targetDate),
        this.profileCollector.collect(userId, targetDate),
        this.healthEventCollector.collect(userId, targetDate),
      ]);

      allSignals = [
        ...medicationSignals,
        ...recordSignals,
        ...profileSignals,
        ...healthEventSignals,
      ];

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
          // Rules report what they could not express as structured facts
          // (`RuleDiagnostic`); deciding whether that deserves a log line is the
          // caller's job, which is what keeps the rule layer framework-free.
          for (const diagnostic of candidate.diagnostics ?? []) {
            this.logger.warn(
              `Rule ${rule.ruleId} dropped route param "${diagnostic.param}" ` +
                `(received ${diagnostic.receivedType}); the action route is incomplete`,
            );
          }
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
    const ruleIds = [...new Set(candidates.map((c) => c.ruleId))];
    const [feedbacks, stats] = await Promise.all([
      this.feedbackRead.loadActive(userId),
      this.feedbackRead.loadStats(userId, ruleIds),
    ]);
    const { candidates: adjustedCandidates } = suppressAndAdjust(
      candidates,
      { feedbacks, stats },
      this.logger,
    );

    // 5. Arbitrate
    const arbitrationResult = arbitrate(adjustedCandidates);

    return { arbitrationResult, degraded, signals: allSignals };
  }
}
