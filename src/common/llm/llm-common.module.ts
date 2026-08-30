import { Module } from '@nestjs/common';
import { LlmSafetyPolicyService } from './safety/llm-safety-policy.service';
import { LlmCircuitBreakerService } from './safety/llm-circuit-breaker.service';

/**
 * Shared LLM infrastructure module.
 *
 * Provides cross-cutting LLM services (`LlmSafetyPolicyService`,
 * `LlmCircuitBreakerService`) so that feature modules no longer need to
 * register their own instances. Import this module instead of listing
 * `LlmSafetyPolicyService` in `providers`.
 *
 * (Architecture review #13 — eliminates 4 duplicate provider registrations.)
 */
@Module({
  providers: [LlmSafetyPolicyService, LlmCircuitBreakerService],
  exports: [LlmSafetyPolicyService, LlmCircuitBreakerService],
})
export class LlmCommonModule {}
