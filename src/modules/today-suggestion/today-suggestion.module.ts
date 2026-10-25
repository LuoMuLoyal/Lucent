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
import { SuggestionCacheService } from './services/cache/suggestion-cache.service.js';
import { MedicationCollectorService } from './services/collectors/medication.service.js';
import { MedicationTimeResolverService } from './services/collectors/medication-time-resolver.service.js';
import { SleepTrendBuilderService } from './adapters/acl/collectors/sleep-trend-builder.js';
import { ProfileCollectorService } from './services/collectors/profile.service.js';
import { RecordCollectorService } from './adapters/acl/collectors/record.js';
import { HealthEventCollectorService } from './adapters/acl/collectors/health-event.js';
import { SuggestionCopyLlmService } from './services/copy/llm-generator.service.js';
import { SuggestionCopyQueueService } from './services/copy/queue.service.js';
import { SuggestionCopyService } from './services/copy/writer.service.js';
import { ExplanationGeneratorService } from './services/explanation/generator.service.js';
import { ExplanationQueueService } from './services/explanation/queue.service.js';
import { ExplanationService } from './services/explanation/explainer.service.js';
import { FeedbackStatsService } from './services/feedback/stats.service.js';
import { FeedbackService } from './services/feedback/recorder.service.js';
import { RecordFeedbackUseCase } from './application/use_cases/record-feedback.js';
import { PrismaFeedbackStore } from './infrastructure/persistence/feedbacks.js';
import { FEEDBACK_PORT } from './application/ports/feedback.js';
import { BaselineService } from './services/lifecycle/baseline.service.js';
import { LifecycleService } from './services/lifecycle/manager.service.js';
import { ActiveSuggestionsReadModel } from './application/read_models/active-suggestions.js';
import { SuggestionHistoryReadModel } from './application/read_models/suggestion-history.js';
import { PrismaSuggestionQueries } from './infrastructure/persistence/suggestion-queries.js';
import { SUGGESTION_QUERY_PORT } from './application/ports/suggestion-queries.js';
import { EscalationService } from './services/notification/escalation.service.js';
import { RegistryService } from './application/services/rule-registry.js';
import { RuleVersionRegistry } from './application/services/rule-version-registry.js';
import { MaterializationStore } from './infrastructure/persistence/materialization.js';
import { RecomputeQueueService } from './services/recompute/queue.service.js';
import { RecomputeEventTriggerService } from './services/recompute/event-trigger.service.js';
import { SuggestionRecomputeWorkerService } from './services/recompute/worker.service.js';
import { SuggestionService } from './services/suggestion.service.js';
import { buildSuggestionRules } from './domain/rule/rule-catalog.js';

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
    MedicationTimeResolverService,
    SleepTrendBuilderService,
    RecordCollectorService,
    ProfileCollectorService,
    HealthEventCollectorService,
    // Rule registries (stateful; the rules themselves are plain objects)
    RegistryService,
    RuleVersionRegistry,
    // Arbitration
    ArbitrationService,
    ScoringService,
    SuppressionService,
    // Lifecycle
    BaselineService,
    LifecycleService,
    ActiveSuggestionsReadModel,
    SuggestionHistoryReadModel,
    PrismaSuggestionQueries,
    { provide: SUGGESTION_QUERY_PORT, useExisting: PrismaSuggestionQueries },
    // Feedback
    FeedbackService,
    RecordFeedbackUseCase,
    PrismaFeedbackStore,
    { provide: FEEDBACK_PORT, useExisting: PrismaFeedbackStore },
    FeedbackStatsService,
    // Cache
    SuggestionCacheService,
    // Recompute trigger and materialization state
    MaterializationStore,
    SuggestionRecomputeWorkerService,
    RecomputeQueueService,
    RecomputeEventTriggerService,
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
    RecordFeedbackUseCase,
    PrismaFeedbackStore,
    { provide: FEEDBACK_PORT, useExisting: PrismaFeedbackStore },
    ExplanationService,
    LifecycleService,
    ActiveSuggestionsReadModel,
    SuggestionHistoryReadModel,
    PrismaSuggestionQueries,
    { provide: SUGGESTION_QUERY_PORT, useExisting: PrismaSuggestionQueries },
  ],
})
export class TodaySuggestionModule implements OnModuleInit {
  constructor(private readonly registry: RegistryService) {}

  onModuleInit() {
    for (const rule of buildSuggestionRules()) {
      this.registry.register(rule);
    }
  }
}
