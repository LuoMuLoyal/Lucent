import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ResultCode } from '../../common/api-envelope';
import type {
  AiChatCapabilitiesDataDto,
  AiChatConversationDataDto,
  AiChatMessageDataDto,
  StreamAiChatMessagesDto,
} from './dto';
import type { AiChatFoundationCapabilities } from './ai-chat.types';
import { AiChatAgentService } from './agent/ai-chat-agent.service';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { AiChatPolicyService } from './ai-chat-policy.service';
import { AiChatToolContextService } from './tools/ai-chat-tool-context.service';
import { AiChatToolExecutor } from './tools/ai-chat-tool.executor';
import { AiChatConversationService } from './ai-chat-conversation.service';
import type {
  AiChatConversationMessage,
  AiChatStreamChunkEvent,
} from './ai-chat.types';

@Injectable()
export class AiChatService {
  constructor(
    private readonly aiChatAgentService: AiChatAgentService,
    private readonly userSettingsService: UserSettingsService,
    private readonly aiChatPolicyService: AiChatPolicyService,
    private readonly aiChatToolExecutor: AiChatToolExecutor,
    private readonly aiChatToolContextService: AiChatToolContextService,
    private readonly aiChatConversationService: AiChatConversationService,
  ) {}

  getFoundationCapabilities(): AiChatFoundationCapabilities {
    return this.aiChatAgentService.describeFoundation();
  }

  async getCapabilities(userId: string): Promise<AiChatCapabilitiesDataDto> {
    const foundation = this.getFoundationCapabilities();
    const settings = await this.userSettingsService.getSettings(userId);
    const policy = this.aiChatPolicyService.evaluate(foundation, settings);

    return {
      phase: foundation.phase,
      aiChatEnabled: settings.aiChatEnabled,
      aiChatContext: settings.aiChatContext,
      chatModelConfigured: foundation.chatModelConfigured,
      interactiveChatReady: policy.interactiveChatReady,
      langGraphReady: foundation.langGraphReady,
      streamingSupported: true,
      streamingTransport: 'sse',
      markdownRenderingRecommended: true,
      ragEnabled: foundation.ragEnabled,
      tools: policy.toolCapabilities,
      updatedAt: settings.updatedAt,
    };
  }

  async getLatestConversation(
    userId: string,
  ): Promise<AiChatConversationDataDto | null> {
    const conversation =
      await this.aiChatConversationService.getLatestConversation(userId);
    return conversation == null ? null : conversation;
  }

  async clearLatestConversation(userId: string): Promise<{
    cleared: boolean;
    archivedConversationId: string | null;
  }> {
    const archived =
      await this.aiChatConversationService.clearLatestConversation(userId);
    return {
      cleared: archived != null,
      archivedConversationId: archived?.id ?? null,
    };
  }

  async streamMessages(
    userId: string,
    dto: StreamAiChatMessagesDto,
    language: string,
    onChunk: (event: AiChatStreamChunkEvent) => void | Promise<void>,
  ): Promise<AiChatMessageDataDto> {
    const locale = this.resolveLocale(language);
    const messages = this.normalizeConversation(dto);
    const lastUserMessage = this.readLastUserMessage(messages, locale);

    const foundation = this.getFoundationCapabilities();
    const settings = await this.userSettingsService.getSettings(userId);
    const policy = this.aiChatPolicyService.evaluate(foundation, settings);

    if (!settings.aiChatEnabled) {
      throw new ForbiddenException({
        code: ResultCode.FORBIDDEN,
        message: this.chatDisabledMessage(locale),
      });
    }

    if (!foundation.chatModelConfigured) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.chatUnavailableMessage(locale),
      });
    }

    const plan = await this.aiChatAgentService.planConversation({
      userId,
      userMessage: lastUserMessage,
      locale,
      enabledContextSources: policy.enabledContextSources,
    });
    const executableTools = plan.selectedTools.filter((toolName) =>
      policy.executableToolNames.includes(toolName),
    );
    const toolResults = await this.aiChatToolExecutor.executeMany(
      userId,
      locale,
      executableTools,
    );
    const result = await this.aiChatAgentService.generateStream(
      {
        locale,
        messages: this.appendToolContextMessage(messages, toolResults),
        allowedTools: executableTools,
        toolResults,
      },
      onChunk,
    );
    const conversation =
      await this.aiChatConversationService.persistAssistantTurn({
        userId,
        messages,
        assistantContent: result.content,
        usedTools: result.usedToolNames,
      });

    return {
      conversationId: conversation.id,
      role: 'assistant',
      content: result.content,
      generatedAt: new Date().toISOString(),
      usedTools: result.usedToolNames,
    };
  }

  private normalizeConversation(
    dto: StreamAiChatMessagesDto,
  ): AiChatConversationMessage[] {
    return dto.messages.map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));
  }

  private appendToolContextMessage(
    messages: AiChatConversationMessage[],
    toolResults: Parameters<
      AiChatToolContextService['buildToolContextBlock']
    >[0],
  ): AiChatConversationMessage[] {
    const contextBlock =
      this.aiChatToolContextService.buildToolContextBlock(toolResults);

    if (contextBlock.length === 0) {
      return messages;
    }

    return [
      {
        role: 'user',
        content: contextBlock,
      },
      ...messages,
    ];
  }

  private readLastUserMessage(
    messages: AiChatConversationMessage[],
    locale: 'zh-CN' | 'en',
  ): string {
    const last = messages.at(-1);
    if (last?.role === 'user' && last.content.length > 0) {
      return last.content;
    }

    throw new BadRequestException({
      code: ResultCode.BAD_REQUEST,
      message: this.invalidConversationMessage(locale),
    });
  }

  private resolveLocale(language: string): 'zh-CN' | 'en' {
    const normalized = language.trim().toLowerCase();
    return normalized.startsWith('zh') ? 'zh-CN' : 'en';
  }

  private chatDisabledMessage(locale: 'zh-CN' | 'en'): string {
    return locale === 'zh-CN'
      ? '当前用户已关闭 AI 聊天功能'
      : 'AI chat is disabled for this user.';
  }

  private chatUnavailableMessage(locale: 'zh-CN' | 'en'): string {
    return locale === 'zh-CN'
      ? 'AI 聊天服务尚未配置'
      : 'AI chat service is not configured.';
  }

  private invalidConversationMessage(locale: 'zh-CN' | 'en'): string {
    return locale === 'zh-CN'
      ? '聊天消息列表的最后一条必须是非空的用户消息'
      : 'The last chat message must be a non-empty user message.';
  }
}
