import { Module } from '@nestjs/common';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { AiChatAgentService } from './agent/ai-chat-agent.service';
import { AiChatService } from './ai-chat.service';

@Module({
  imports: [LlmRuntimeModule],
  providers: [AiChatAgentService, AiChatService],
  exports: [AiChatAgentService, AiChatService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class AiChatModule {}
