import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DailyRecordsModule } from '../daily-records/daily-records.module';
import { LlmRuntimeModule } from '../llm-runtime/llm-runtime.module';
import { MedicineRemindersModule } from '../medicine-reminders/medicine-reminders.module';
import { UserHealthContextModule } from '../user-health-context/user-health-context.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { AiChatAgentService } from './agent/ai-chat-agent.service';
import { AiChatConversationService } from './ai-chat-conversation.service';
import { AiChatController } from './ai-chat.controller';
import { AiChatPolicyService } from './ai-chat-policy.service';
import { AiSummaryHistoryService } from './ai-summary-history.service';
import { AiChatService } from './ai-chat.service';
import { AiChatToolContextService, AiChatToolExecutor } from './tools';

@Module({
  imports: [
    AuthModule,
    LlmRuntimeModule,
    UserSettingsModule,
    UserHealthContextModule,
    DailyRecordsModule,
    MedicineRemindersModule,
  ],
  controllers: [AiChatController],
  providers: [
    AiChatAgentService,
    AiChatConversationService,
    AiChatPolicyService,
    AiSummaryHistoryService,
    AiChatToolContextService,
    AiChatToolExecutor,
    AiChatService,
  ],
  exports: [
    AiChatAgentService,
    AiChatPolicyService,
    AiSummaryHistoryService,
    AiChatService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class AiChatModule {}
