import { Module } from '@nestjs/common';
import { LlmRuntimeService } from './services/llm-runtime.service';

/**
 * Pure internal service module — provides AI model creation to other modules.
 * No controller is needed; consumers inject LlmRuntimeService directly.
 */
@Module({
  providers: [LlmRuntimeService],
  exports: [LlmRuntimeService],
})
export class LlmRuntimeModule {}
