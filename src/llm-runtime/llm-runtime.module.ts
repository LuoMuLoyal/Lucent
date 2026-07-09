import { Module } from '@nestjs/common';
import { LlmRuntimeService } from './services/llm-runtime.service';

/**
 * Pure internal infrastructure module — provides LLM model creation to other
 * modules. No controller is needed; consumers inject LlmRuntimeService directly.
 *
 * Lives at `src/llm-runtime/` (alongside `src/prisma/`, `src/mail/`, `src/i18n/`)
 * because it is cross-cutting infrastructure, not a feature module.
 */
@Module({
  providers: [LlmRuntimeService],
  exports: [LlmRuntimeService],
})
export class LlmRuntimeModule {}
