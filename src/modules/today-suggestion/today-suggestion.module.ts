import { Module, OnModuleInit } from '@nestjs/common';

import { LlmCommonModule } from '../../common';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { PrismaModule } from '../../prisma';
import { DailyRecordsModule } from '../daily-records/daily-records.module';
import { MedicineDoseLogsModule } from '../medicine-dose-logs/medicine-dose-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { TodaySuggestionController } from './today-suggestion.controller';
import { ArbitrationService } from './services/arbitration/service';
import { ScoringService } from './services/arbitration/scoring.service';
import { SuppressionService } from './services/arbitration/suppression.service';
import { SuggestionCacheInvalidationListener } from './services/cache/suggestion-cache-invalidation.listener';
import { SuggestionCacheService } from './services/cache/suggestion-cache.service';
import { MedicationCollectorService } from './services/collectors/medication.service';
import { ProfileCollectorService } from './services/collectors/profile.service';
import { RecordCollectorService } from './services/collectors/record.service';
import { SuggestionCopyLlmService } from './services/copy/copy-llm-generator.service';
import { SuggestionCopyQueueService } from './services/copy/copy-queue.service';
import { SuggestionCopyService } from './services/copy/copy.service';
import { ExplanationGeneratorService } from './services/explanation/generator.service';
import { ExplanationQueueService } from './services/explanation/queue.service';
import { ExplanationService } from './services/explanation/service';
import { FeedbackStatsService } from './services/feedback/stats.service';
import { FeedbackService } from './services/feedback/service';
import { BaselineService } from './services/lifecycle/baseline.service';
import { LifecycleService } from './services/lifecycle/service';
import { EscalationService } from './services/notification/escalation.service';
import { CaffeineSleepRuleService } from './services/rules/caffeine-sleep.service';
import { CoverageRuleService } from './services/rules/coverage.service';
import { DeterioratingTrendRuleService } from './services/rules/deteriorating-trend.service';
import { MissedDoseRuleService } from './services/rules/missed-dose.service';
import { MoodSleepRuleService } from './services/rules/mood-sleep.service';
import { RegistryService } from './services/rules/registry.service';
import { RuleVersionRegistry } from './services/rules/rule-version-registry.service';
import { SleepShortfallRuleService } from './services/rules/sleep-shortfall.service';
import { WaterShortfallRuleService } from './services/rules/water-shortfall.service';
import { SuggestionService } from './services/suggestion.service';
import type { SuggestionRule } from './types/rule.types';

/**
 * Today Suggestion module — the backend suggestion engine.
 *
 * Pipeline: Signal → Candidate (rule engine) → Suppression → Arbitration → Lifecycle → Notification → DTO
 */
@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    LlmRuntimeModule,
    LlmCommonModule,
    DailyRecordsModule,
    MedicineDoseLogsModule,
  ],
  controllers: [TodaySuggestionController],
  providers: [
    // Collectors
    MedicationCollectorService,
    RecordCollectorService,
    ProfileCollectorService,
    // Rules (injectable, registered in registry at startup)
    RegistryService,
    RuleVersionRegistry,
    MissedDoseRuleService,
    WaterShortfallRuleService,
    SleepShortfallRuleService,
    DeterioratingTrendRuleService,
    CaffeineSleepRuleService,
    MoodSleepRuleService,
    CoverageRuleService,
    // Arbitration
    ArbitrationService,
    ScoringService,
    SuppressionService,
    // Lifecycle
    BaselineService,
    LifecycleService,
    // Feedback
    FeedbackService,
    FeedbackStatsService,
    // Cache
    SuggestionCacheService,
    SuggestionCacheInvalidationListener,
    // Notification escalation
    EscalationService,
    // AI explanation
    ExplanationGeneratorService,
    ExplanationService,
    ExplanationQueueService,
    // AI copy generation
    SuggestionCopyLlmService,
    SuggestionCopyQueueService,
    SuggestionCopyService,
    // Orchestrator
    SuggestionService,
  ],
  exports: [SuggestionService, FeedbackService, ExplanationService],
})
export class TodaySuggestionModule implements OnModuleInit {
  constructor(
    private readonly registry: RegistryService,
    private readonly missedDoseRule: MissedDoseRuleService,
    private readonly waterShortfallRule: WaterShortfallRuleService,
    private readonly sleepShortfallRule: SleepShortfallRuleService,
    private readonly deterioratingTrendRule: DeterioratingTrendRuleService,
    private readonly caffeineSleepRule: CaffeineSleepRuleService,
    private readonly moodSleepRule: MoodSleepRuleService,
    private readonly coverageRule: CoverageRuleService,
  ) {}

  onModuleInit() {
    const rules: SuggestionRule[] = [
      this.missedDoseRule,
      this.waterShortfallRule,
      this.sleepShortfallRule,
      this.deterioratingTrendRule,
      this.caffeineSleepRule,
      this.moodSleepRule,
      this.coverageRule,
    ];

    for (const rule of rules) {
      this.registry.register(rule);
    }
  }
}
