import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { DailyRecordsModule } from '../daily-records/daily-records.module';
import { MedicineDoseLogsModule } from '../medicine-dose-logs/medicine-dose-logs.module';
import { TodaySuggestionController } from './today-suggestion.controller';
import { SuggestionService } from './services/suggestion.service';
import { MedicationCollectorService } from './services/collectors/medication.service';
import { RecordCollectorService } from './services/collectors/record.service';
import { ProfileCollectorService } from './services/collectors/profile.service';
import { RegistryService } from './services/rules/registry.service';
import {
  MissedDoseRuleService,
  WaterShortfallRuleService,
  SleepShortfallRuleService,
  DeterioratingTrendRuleService,
  CaffeineSleepRuleService,
  MoodSleepRuleService,
  CoverageRuleService,
} from './services/rules';
import { ArbitrationService } from './services/arbitration/service';
import { ScoringService } from './services/arbitration/scoring.service';
import { SuppressionService } from './services/arbitration/suppression.service';
import { BaselineService } from './services/lifecycle/baseline.service';
import { LifecycleService } from './services/lifecycle/service';
import { FeedbackService } from './services/feedback/service';
import { FeedbackStatsService } from './services/feedback/stats.service';
import { SuggestionCacheService } from './services/cache/suggestion-cache.service';
import { RuleVersionRegistry } from './services/rules/rule-version-registry.service';
import { EscalationService } from './services/notification/escalation.service';
import { ExplanationGeneratorService } from './services/explanation/generator.service';
import { ExplanationService } from './services/explanation/service';
import { ExplanationQueueService } from './services/explanation/queue.service';
import { LlmSafetyPolicyService } from '../../common/llm/llm-safety-policy.service';
import type { SuggestionRule } from './types';

/**
 * Today Suggestion module — the backend suggestion engine.
 *
 * Pipeline: Signal → Candidate (rule engine) → Suppression → Arbitration → Lifecycle → Notification → DTO
 */
@Module({
  // forwardRef on DailyRecordsModule / MedicineDoseLogsModule: both import
  // this module for suggestion-cache invalidation, while collectors here
  // consume their reader ports (ADR-0009). The reverse edge is removed once
  // architecture-review #2 moves invalidation to domain events.
  imports: [
    PrismaModule,
    NotificationsModule,
    LlmRuntimeModule,
    forwardRef(() => DailyRecordsModule),
    forwardRef(() => MedicineDoseLogsModule),
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
    // Notification escalation
    EscalationService,
    // AI explanation
    ExplanationGeneratorService,
    ExplanationService,
    ExplanationQueueService,
    LlmSafetyPolicyService,
    // Orchestrator
    SuggestionService,
  ],
  exports: [
    SuggestionService,
    FeedbackService,
    ExplanationService,
    SuggestionCacheService,
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
