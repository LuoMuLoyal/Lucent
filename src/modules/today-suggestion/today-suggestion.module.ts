import { Module, OnModuleInit } from '@nestjs/common';

import { LlmCommonModule } from '../../common/index.js';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module.js';
import { PrismaModule } from '../../prisma/index.js';
import { DailyRecordsModule } from '../daily-records/daily-records.module.js';
import { MedicineDoseLogsModule } from '../medicine-dose-logs/medicine-dose-logs.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { NotificationPreferencesModule } from '../notification-preferences/notification-preferences.module.js';
import { UserSettingsModule } from '../user-settings/user-settings.module.js';
import { ProductEventsModule } from '../product-events/product-events.module.js';
import { HealthEventsModule } from '../health-events/health-events.module.js';

import { TodaySuggestionController } from './today-suggestion.controller.js';
import { SuggestionPipelineService } from './services/pipeline.service.js';
import { SuggestionPresentationService } from './services/presentation.service.js';
import { ArbitrationService } from './services/arbitration/arbiter.service.js';
import { ScoringService } from './services/arbitration/scoring.service.js';
import { SuppressionService } from './services/arbitration/suppression.service.js';
import { SuggestionCacheInvalidationListener } from './services/cache/suggestion-cache-invalidation.listener.js';
import { SuggestionCacheService } from './services/cache/suggestion-cache.service.js';
import { MedicationCollectorService } from './services/collectors/medication.service.js';
import { ProfileCollectorService } from './services/collectors/profile.service.js';
import { RecordCollectorService } from './services/collectors/record.service.js';
import { HealthEventCollectorService } from './services/collectors/health-event.service.js';
import { SuggestionCopyLlmService } from './services/copy/llm-generator.service.js';
import { SuggestionCopyQueueService } from './services/copy/queue.service.js';
import { SuggestionCopyService } from './services/copy/writer.service.js';
import { ExplanationGeneratorService } from './services/explanation/generator.service.js';
import { ExplanationQueueService } from './services/explanation/queue.service.js';
import { ExplanationService } from './services/explanation/explainer.service.js';
import { FeedbackStatsService } from './services/feedback/stats.service.js';
import { FeedbackService } from './services/feedback/recorder.service.js';
import { BaselineService } from './services/lifecycle/baseline.service.js';
import { LifecycleService } from './services/lifecycle/manager.service.js';
import { EscalationService } from './services/notification/escalation.service.js';
import { CaffeineSleepRuleService } from './services/rules/sleep/caffeine-sleep.service.js';
import { CoverageRuleService } from './services/rules/medication/coverage.service.js';
import { EventCheckInTrendRuleService } from './services/rules/health/event-check-in-trend.service.js';
import { DeterioratingTrendRuleService } from './services/rules/lifestyle/deteriorating-trend.service.js';
import { MissedDoseRuleService } from './services/rules/medication/missed-dose.service.js';
import { MoodSleepRuleService } from './services/rules/sleep/mood-sleep.service.js';
import { RegistryService } from './services/rules/registry.service.js';
import { RuleVersionRegistry } from './services/rules/rule-version-registry.service.js';
import { SleepShortfallRuleService } from './services/rules/sleep/sleep-shortfall.service.js';
import { WaterShortfallRuleService } from './services/rules/lifestyle/water-shortfall.service.js';
import { MaterializationStore } from './services/materialization/store.service.js';
import { RecomputeQueueService } from './services/recompute/queue.service.js';
import { RecomputeTriggerListener } from './services/recompute/trigger.listener.js';
import { SuggestionRecomputeWorkerService } from './services/recompute/worker.service.js';
import { SuggestionService } from './services/suggestion.service.js';
import type { SuggestionRule } from './types/rule.types.js';

/**
 * Today Suggestion module — the backend suggestion engine.
 *
 * Pipeline: Signal → Candidate (rule engine) → Suppression → Arbitration → Lifecycle → Notification → DTO
 */
@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    NotificationPreferencesModule,
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
