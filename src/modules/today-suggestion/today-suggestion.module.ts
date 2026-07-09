import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
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
  CoverageRuleService,
} from './services/rules';
import { ArbitrationService } from './services/arbitration/arbitration.service';
import { ScoringService } from './services/arbitration/scoring.service';
import { SuppressionService } from './services/arbitration/suppression.service';
import { BaselineService } from './services/lifecycle/baseline.service';
import { LifecycleService } from './services/lifecycle/lifecycle.service';
import { FeedbackService } from './services/feedback/feedback.service';
import { EscalationService } from './services/notification/escalation.service';
import { ExplanationGeneratorService } from './services/explanation/explanation-generator.service';
import { ExplanationService } from './services/explanation/explanation.service';
import { AiSafetyPolicyService } from '../../common/ai/ai-safety-policy.service';
import type { SuggestionRule } from './types';

/**
 * Today Suggestion module — the backend suggestion engine.
 *
 * Pipeline: Signal → Candidate (rule engine) → Suppression → Arbitration → Lifecycle → Notification → DTO
 */
@Module({
  imports: [PrismaModule, NotificationsModule, LlmRuntimeModule],
  controllers: [TodaySuggestionController],
  providers: [
    // Collectors
    MedicationCollectorService,
    RecordCollectorService,
    ProfileCollectorService,
    // Rules (injectable, registered in registry at startup)
    RegistryService,
    MissedDoseRuleService,
    WaterShortfallRuleService,
    SleepShortfallRuleService,
    DeterioratingTrendRuleService,
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
    // Notification escalation
    EscalationService,
    // AI explanation
    ExplanationGeneratorService,
    ExplanationService,
    AiSafetyPolicyService,
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
    private readonly coverageRule: CoverageRuleService,
  ) {}

  onModuleInit() {
    const rules: SuggestionRule[] = [
      this.missedDoseRule,
      this.waterShortfallRule,
      this.sleepShortfallRule,
      this.deterioratingTrendRule,
      this.coverageRule,
    ];

    for (const rule of rules) {
      this.registry.register(rule);
    }
  }
}
