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
import { UserHealthContextModule } from '../user-health-context/user-health-context.module.js';
import { MedicineRemindersModule } from '../medicine-reminders/medicine-reminders.module.js';

import { TodaySuggestionController } from './today-suggestion.controller.js';
import { SuggestionPipelineService } from './application/services/pipeline.js';
import { SuggestionPresentationService } from './application/services/presentation.js';
import { SuggestionCacheService } from './infrastructure/cache/suggestions.js';
import { SUGGESTION_CACHE_PORT } from './application/ports/suggestion-cache.js';
import { MATERIALIZATION_STORE_PORT } from './application/ports/materialization.js';
import { BASELINE_PORT } from './application/ports/baseline.js';
import {
  MEDICATION_COLLECTOR_PORT,
  RECORD_COLLECTOR_PORT,
  PROFILE_COLLECTOR_PORT,
  HEALTH_EVENT_COLLECTOR_PORT,
} from './application/ports/collectors.js';
import { ESCALATION_PORT } from './application/services/suggestions.js';
import { MedicationCollectorService } from './adapters/acl/collectors/medication.js';
import { MedicationTimeResolverService } from './adapters/acl/collectors/medication-time-resolver.js';
import { SleepTrendBuilderService } from './adapters/acl/collectors/sleep-trend-builder.js';
import { ProfileCollectorService } from './adapters/acl/collectors/profile.js';
import { RecordCollectorService } from './adapters/acl/collectors/record.js';
import { HealthEventCollectorService } from './adapters/acl/collectors/health-event.js';
import { SuggestionCopyLlmService } from './infrastructure/llm/copy-generator.js';
import { COPY_GENERATOR } from './adapters/queue/copy/writer.js';
import {
  COPY_QUEUE,
  COPY_SERVICE,
} from './application/services/presentation.js';
import { SuggestionCopyQueueService } from './adapters/queue/copy/queue.js';
import { SuggestionCopyService } from './adapters/queue/copy/writer.js';
import { ExplanationGeneratorService } from './infrastructure/llm/explanation-generator.js';
import { EXPLANATION_GENERATOR } from './adapters/queue/explanation/explainer.js';
import { ExplanationQueueService } from './adapters/queue/explanation/queue.js';
import { ExplanationService } from './adapters/queue/explanation/explainer.js';
import { FeedbackReadModel } from './application/read_models/feedback-read.js';
import { RecordFeedbackUseCase } from './application/use_cases/record-feedback.js';
import { PrismaFeedbackStore } from './infrastructure/persistence/feedbacks.js';
import { FEEDBACK_PORT } from './application/ports/feedback.js';
import { BaselineService } from './infrastructure/persistence/baseline.js';
import { LifecycleService } from './application/services/lifecycle.js';
import {
  SUGGESTION_LIFECYCLE_STORE,
  SuggestionLifecycleStore,
} from './application/ports/suggestion-lifecycle.js';
import { PrismaSuggestionLifecycleStore } from './infrastructure/persistence/suggestion-lifecycle.js';
import { ActiveSuggestionsReadModel } from './application/read_models/active-suggestions.js';
import { SuggestionHistoryReadModel } from './application/read_models/suggestion-history.js';
import { PrismaSuggestionQueries } from './infrastructure/persistence/suggestion-queries.js';
import { SUGGESTION_QUERY_PORT } from './application/ports/suggestion-queries.js';
import { EscalationService } from './infrastructure/notifications/escalation.js';
import { RegistryService } from './application/services/rule-registry.js';
import { RuleVersionRegistry } from './application/services/rule-version-registry.js';
import { MaterializationStore } from './infrastructure/persistence/materialization.js';
import { RecomputeQueueService } from './adapters/queue/queue.service.js';
import { RecomputeEventTriggerService } from './adapters/queue/event-trigger.service.js';
import { SuggestionRecomputeWorkerService } from './adapters/queue/worker.service.js';
import { SuggestionService } from './application/services/suggestions.js';
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
    // The collectors inject these two reader ports; the owning modules must be
    // imported for their exported tokens to resolve.
    UserHealthContextModule,
    MedicineRemindersModule,
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
    // Lifecycle
    BaselineService,
    LifecycleService,
    PrismaSuggestionLifecycleStore,
    // `LifecycleService` injects the abstract class by type, so bind it by class
    // as well — the string token only serves callers that inject by name.
    {
      provide: SuggestionLifecycleStore,
      useExisting: PrismaSuggestionLifecycleStore,
    },
    {
      provide: SUGGESTION_LIFECYCLE_STORE,
      useExisting: PrismaSuggestionLifecycleStore,
    },
    ActiveSuggestionsReadModel,
    SuggestionHistoryReadModel,
    PrismaSuggestionQueries,
    { provide: SUGGESTION_QUERY_PORT, useExisting: PrismaSuggestionQueries },
    // Feedback
    RecordFeedbackUseCase,
    FeedbackReadModel,
    PrismaFeedbackStore,
    { provide: FEEDBACK_PORT, useExisting: PrismaFeedbackStore },
    // Cache
    SuggestionCacheService,
    { provide: SUGGESTION_CACHE_PORT, useExisting: SuggestionCacheService },
    // Port tokens injected by name in the queue adapters and pipeline services.
    { provide: MATERIALIZATION_STORE_PORT, useExisting: MaterializationStore },
    { provide: BASELINE_PORT, useExisting: BaselineService },
    {
      provide: MEDICATION_COLLECTOR_PORT,
      useExisting: MedicationCollectorService,
    },
    { provide: RECORD_COLLECTOR_PORT, useExisting: RecordCollectorService },
    { provide: PROFILE_COLLECTOR_PORT, useExisting: ProfileCollectorService },
    {
      provide: HEALTH_EVENT_COLLECTOR_PORT,
      useExisting: HealthEventCollectorService,
    },
    { provide: ESCALATION_PORT, useExisting: EscalationService },
    // Recompute trigger and materialization state
    MaterializationStore,
    SuggestionRecomputeWorkerService,
    RecomputeQueueService,
    RecomputeEventTriggerService,
    // Notification escalation
    EscalationService,
    // AI explanation
    ExplanationGeneratorService,
    {
      provide: EXPLANATION_GENERATOR,
      useExisting: ExplanationGeneratorService,
    },
    ExplanationService,
    ExplanationQueueService,
    // AI copy generation
    SuggestionCopyLlmService,
    { provide: COPY_GENERATOR, useExisting: SuggestionCopyLlmService },
    SuggestionCopyQueueService,
    SuggestionCopyService,
    { provide: COPY_SERVICE, useExisting: SuggestionCopyService },
    { provide: COPY_QUEUE, useExisting: SuggestionCopyQueueService },
    // Pipeline + Presentation (extracted from orchestrator)
    SuggestionPipelineService,
    SuggestionPresentationService,
    // Orchestrator
    SuggestionService,
  ],
  exports: [
    SuggestionService,
    RecordFeedbackUseCase,
    PrismaFeedbackStore,
    { provide: FEEDBACK_PORT, useExisting: PrismaFeedbackStore },
    ExplanationService,
    LifecycleService,
    PrismaSuggestionLifecycleStore,
    // `LifecycleService` injects the abstract class by type, so bind it by class
    // as well — the string token only serves callers that inject by name.
    {
      provide: SuggestionLifecycleStore,
      useExisting: PrismaSuggestionLifecycleStore,
    },
    {
      provide: SUGGESTION_LIFECYCLE_STORE,
      useExisting: PrismaSuggestionLifecycleStore,
    },
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
