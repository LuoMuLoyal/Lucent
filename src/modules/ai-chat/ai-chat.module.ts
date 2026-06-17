import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { AiChatAgentService } from './agent/ai-chat-agent.service';
import { AiChatController } from './ai-chat.controller';
import { AiChatPolicyService } from './ai-chat-policy.service';
import { AiChatService } from './ai-chat.service';

@Module({
  imports: [AuthModule, LlmRuntimeModule, UserSettingsModule],
  controllers: [AiChatController],
  providers: [AiChatAgentService, AiChatPolicyService, AiChatService],
  exports: [AiChatAgentService, AiChatPolicyService, AiChatService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class AiChatModule {}
