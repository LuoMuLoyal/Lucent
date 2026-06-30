import { Module } from '@nestjs/common';
import { LlmRuntimeService } from './services/llm-runtime.service';

@Module({
  providers: [LlmRuntimeService],
  exports: [LlmRuntimeService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class LlmRuntimeModule {}
