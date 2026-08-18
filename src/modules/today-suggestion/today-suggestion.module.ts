import { Module, OnModuleInit } from '@nestjs/common';

import { LlmCommonModule } from '../../common';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { PrismaModule } from '../../prisma';
import { DailyRecordsModule } from '../daily-records/daily-records.module';
import { MedicineDoseLogsModule } from '../medicine-dose-logs/medicine-dose-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { ProductEventsModule } from '../product-events/product-events.module';
import { HealthEventsModule } from '../health-events/health-events.module';

import { TodaySuggestionController } from './today-suggestion.controller';
import { SuggestionPipelineService } from './services/pipeline.service';
import { SuggestionPresentationService } from './services/presentation.service';
import { ArbitrationService } from './services/arbitration/arbiter.service';
import { ScoringService } from './services/arbitration/scoring.service';
import { SuppressionService } from './services/arbitration/suppression.service';
import { SuggestionCacheInvalidationListener } from './services/cache/suggestion-cache-invalidation.listener';
import { SuggestionCacheService } from './services/cache/suggestion-cache.service';
import { MedicationCollectorService } from './services/collectors/medication.service';
import { ProfileCollectorService } from './services/collectors/profile.service';
import { RecordCollectorService } from './services/collectors/record.service';
import { HealthEventCollectorService } from './services/collectors/health-event.service';
import { SuggestionCopyLlmService } from './services/copy/llm-generator.service';
import { SuggestionCopyQueueService } from './services/copy/queue.service';
import { SuggestionCopyService } from './services/copy/writer.service';
import { ExplanationGeneratorService } from './services/explanation/generator.service';
import { ExplanationQueueService } from './services/explanation/queue.service';
import { ExplanationService } from './services/explanation/explainer.service';
import { FeedbackStatsService } from './services/feedback/stats.service';
import { FeedbackService } from './services/feedback/recorder.service';
import { BaselineService } from './services/lifecycle/baseline.service';
import { LifecycleService } from './services/lifecycle/manager.service';
import { EscalationService } from './services/notification/escalation.service';
import { CaffeineSleepRuleService } from './services/rules/sleep/caffeine-sleep.service';
import { CoverageRuleService } from './services/rules/medication/coverage.service';
import { EventCheckInTrendRuleService } from './services/rules/health/event-check-in-trend.service';
import { DeterioratingTrendRuleService } from './services/rules/lifestyle/deteriorating-trend.service';
import { MissedDoseRuleService } from './services/rules/medication/missed-dose.service';
import { MoodSleepRuleService } from './services/rules/sleep/mood-sleep.service';
import { RegistryService } from './services/rules/registry.service';
import { RuleVersionRegistry } from './services/rules/rule-version-registry.service';
import { SleepShortfallRuleService } from './services/rules/sleep/sleep-shortfall.service';
import { WaterShortfallRuleService } from './services/rules/lifestyle/water-shortfall.service';
import { MaterializationStore } from './services/materialization/store.service';
import { RecomputeQueueService } from './services/recompute/queue.service';
import { RecomputeTriggerListener } from './services/recompute/trigger.listener';
import { SuggestionRecomputeWorkerService } from './services/recompute/worker.service';
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
    UserSettingsModule,
    ProductEventsModule,
    HealthEventsModule,
  ],
  controllers: [TodaySuggestionController],
  providers: [
    // Collectors
    MedicationCollectorService,
    RecordCollectorService,
    ProfileCollectorService,
    HealthEventCollectorService,
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
    EventCheckInTrendRuleService,
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
    // Recompute trigger and materialization state
    MaterializationStore,
    SuggestionRecomputeWorkerService,
    RecomputeQueueService,
    RecomputeTriggerListener,
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
    // Pipeline + Presentation (extracted from orchestrator)
    SuggestionPipelineService,
    SuggestionPresentationService,
    // Orchestrator
    SuggestionService,
  ],
  exports: [
    SuggestionService,
    FeedbackService,
    ExplanationService,
    LifecycleService,
  ],
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
    private readonly eventCheckInTrendRule: EventCheckInTrendRuleService,
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
      this.eventCheckInTrendRule,
    ];

    for (const rule of rules) {
      this.registry.register(rule);
    }
  }
}
