import { Module } from '@nestjs/common';
import { LlmSafetyPolicyService } from './llm-safety-policy.service';

/**
 * Shared LLM infrastructure module.
 *
 * Provides cross-cutting LLM services (`LlmSafetyPolicyService`, and future
 * base generators) so that feature modules no longer need to register their
 * own instances. Import this module instead of listing `LlmSafetyPolicyService`
 * in `providers`.
 *
 * (Architecture review #13 — eliminates 4 duplicate provider registrations.)
 */
@Module({
  providers: [LlmSafetyPolicyService],
  exports: [LlmSafetyPolicyService],
})
export class LlmCommonModule {}
