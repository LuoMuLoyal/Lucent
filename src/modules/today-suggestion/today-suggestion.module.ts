import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { NotificationsModule } from '../notifications/notifications.module';
import { LlmCommonModule } from '../../common/llm';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module';
import { DailyRecordsModule } from '../daily-records/daily-records.module';
import { MedicineDoseLogsModule } from '../medicine-dose-logs/medicine-dose-logs.module';
import { TodaySuggestionController } from './today-suggestion.controller';
import { SuggestionService } from './services';
import {
  MedicationCollectorService,
  ProfileCollectorService,
  RecordCollectorService,
} from './services/collectors';
import {
  CaffeineSleepRuleService,
  CoverageRuleService,
  DeterioratingTrendRuleService,
  MissedDoseRuleService,
  MoodSleepRuleService,
  RegistryService,
  RuleVersionRegistry,
  SleepShortfallRuleService,
  WaterShortfallRuleService,
} from './services/rules';
import {
  ArbitrationService,
  ScoringService,
  SuppressionService,
} from './services/arbitration';
import { BaselineService, LifecycleService } from './services/lifecycle';
import { FeedbackService, FeedbackStatsService } from './services/feedback';
import {
  SuggestionCacheInvalidationListener,
  SuggestionCacheService,
} from './services/cache';
import { EscalationService } from './services/notification';
import {
  ExplanationGeneratorService,
  ExplanationQueueService,
  ExplanationService,
} from './services/explanation';
import {
  SuggestionCopyLlmService,
  SuggestionCopyQueueService,
  SuggestionCopyService,
} from './services/copy';
import type { SuggestionRule } from './types';

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
