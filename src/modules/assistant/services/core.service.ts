import { badRequest, forbidden } from '../../../common/helpers';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ResultCode } from '../../../common/api';
import type {
  AssistantCapabilitiesDataDto,
  AssistantConversationDataDto,
  AssistantMessageDataDto,
  StreamAssistantMessagesDto,
} from '../dto';
import type { AssistantRuntimeCapabilities } from '../types';
import { AssistantRuntimeService } from '../agent/runtime.service';
import { UserSettingsService } from '../../user-settings/services/user-settings.service';
import { AssistantPolicyService } from './policy.service';
import { AssistantContextService } from '../tools/context.service';
import { AssistantToolService } from '../tools/tool.service';
import { AssistantConversationService } from './conversation.service';
import { nowIsoString } from '../../../common/helpers';
import type {
  AssistantConversationMessage,
  AssistantMessageResult,
  AssistantStreamChunkEvent,
  AssistantToolExecutionContext,
} from '../types';

@Injectable()
export class AssistantService {
  constructor(
    private readonly assistantAgentService: AssistantRuntimeService,
    private readonly userSettingsService: UserSettingsService,
    private readonly assistantPolicyService: AssistantPolicyService,
    private readonly assistantToolExecutor: AssistantToolService,
    private readonly assistantToolContextService: AssistantContextService,
    private readonly assistantConversationService: AssistantConversationService,
  ) {}

  async getFoundationCapabilities(): Promise<AssistantRuntimeCapabilities> {
    return this.assistantAgentService.describeFoundation();
  }

  async getCapabilities(userId: string): Promise<AssistantCapabilitiesDataDto> {
    const foundation = await this.getFoundationCapabilities();
    const settings = await this.userSettingsService.getSettings(userId);
    const policy = this.assistantPolicyService.evaluate(foundation, settings);

    return {
      phase: foundation.phase,
      assistantEnabled: settings.assistantEnabled,
      assistantMemoryEnabled: settings.assistantMemoryEnabled,
      assistantContext: settings.assistantContext,
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
  ): Promise<AssistantConversationDataDto | null> {
    const conversation =
      await this.assistantConversationService.getLatestConversation(userId);
    return conversation == null ? null : conversation;
  }

  async listRecentConversations(userId: string) {
    return this.assistantConversationService.listRecentConversations(userId);
  }

  async openConversation(
    userId: string,
    conversationId: string,
  ): Promise<AssistantConversationDataDto> {
    return this.assistantConversationService.openConversation(
      userId,
      conversationId,
    );
  }

  async clearLatestConversation(userId: string): Promise<{
    cleared: boolean;
    archivedConversationId: string | null;
  }> {
    const archived =
      await this.assistantConversationService.clearLatestConversation(userId);
    return {
      cleared: archived != null,
      archivedConversationId: archived?.id ?? null,
    };
  }

  async streamMessages(
    userId: string,
    dto: StreamAssistantMessagesDto,
    language: string,
    onChunk: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): Promise<AssistantMessageDataDto> {
    const locale = this.resolveLocale(language);
    const messages = this.normalizeConversation(dto);
    const lastUserMessage = this.readLastUserMessage(messages, locale);

    const foundation = await this.getFoundationCapabilities();
    const settings = await this.userSettingsService.getSettings(userId);
    const policy = this.assistantPolicyService.evaluate(foundation, settings);

    if (!settings.assistantEnabled) {
      forbidden(this.chatDisabledMessage(locale));
    }

    if (!foundation.chatModelConfigured) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.chatUnavailableMessage(locale),
      });
    }

    const toolContext: AssistantToolExecutionContext = {
      userId,
      locale,
      userMessage: lastUserMessage,
      enabledContextSources: policy.enabledContextSources,
      memoryEnabled: settings.assistantMemoryEnabled,
    };

    const conversationResult = await this.assistantAgentService.runConversation(
      {
        userId,
        userMessage: lastUserMessage,
        locale,
        enabledContextSources: policy.enabledContextSources,
      },
      async (toolNames) => {
        const executable = toolNames.filter((name) =>
          policy.executableToolNames.includes(name),
        );
        return this.assistantToolExecutor.executeMany(toolContext, executable);
      },
    );

    let result: AssistantMessageResult;
    if (conversationResult.finalContent != null) {
      result = await this.assistantAgentService.streamPreGeneratedContent(
        conversationResult.finalContent,
        conversationResult.toolResults,
        onChunk,
      );
    } else {
      result = await this.assistantAgentService.generateStream(
        {
          locale,
          messages: await this.buildGenerationMessages(
            userId,
            messages,
            conversationResult.toolResults,
            settings.assistantMemoryEnabled,
          ),
          allowedTools: conversationResult.selectedTools,
          toolResults: conversationResult.toolResults,
        },
        onChunk,
      );
    }

    const conversation =
      await this.assistantConversationService.persistAssistantTurn({
        userId,
        messages,
        assistantContent: result.content,
        usedTools: result.usedToolNames,
      });

    return {
      conversationId: conversation.id,
      role: 'assistant',
      content: result.content,
      generatedAt: nowIsoString(),
      usedTools: result.usedToolNames,
      proposedActions: conversationResult.toolResults.flatMap(
        (toolResult) => toolResult.proposedActions ?? [],
      ),
    };
  }

  private normalizeConversation(
    dto: StreamAssistantMessagesDto,
  ): AssistantConversationMessage[] {
    return dto.messages.map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));
  }

  private appendToolContextMessage(
    messages: AssistantConversationMessage[],
    toolResults: Parameters<
      AssistantContextService['buildToolContextBlock']
    >[0],
  ): AssistantConversationMessage[] {
    const contextBlock =
      this.assistantToolContextService.buildToolContextBlock(toolResults);

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

  private async buildGenerationMessages(
    userId: string,
    messages: AssistantConversationMessage[],
    toolResults: Parameters<
      AssistantContextService['buildToolContextBlock']
    >[0],
    memoryEnabled: boolean,
  ): Promise<AssistantConversationMessage[]> {
    const output: AssistantConversationMessage[] = [];

    if (memoryEnabled && this.isNewConversation(messages)) {
      const memoryBlock =
        await this.assistantConversationService.buildMemoryBlock(userId);
      if (memoryBlock.length > 0) {
        output.push({
          role: 'user',
          content: memoryBlock,
        });
      }
    }

    return [...output, ...this.appendToolContextMessage(messages, toolResults)];
  }

  private isNewConversation(messages: AssistantConversationMessage[]): boolean {
    return messages.filter((message) => message.role === 'user').length <= 1;
  }

  private readLastUserMessage(
    messages: AssistantConversationMessage[],
    locale: 'zh-CN' | 'en',
  ): string {
    const last = messages.at(-1);
    if (last?.role === 'user' && last.content.length > 0) {
      return last.content;
    }

    badRequest(this.invalidConversationMessage(locale));
  }

  private resolveLocale(language: string): 'zh-CN' | 'en' {
    const normalized = language.trim().toLowerCase();
    return normalized.startsWith('zh') ? 'zh-CN' : 'en';
  }

  private chatDisabledMessage(locale: 'zh-CN' | 'en'): string {
    return locale === 'zh-CN'
      ? '当前用户已关闭助手功能'
      : 'Assistant is disabled for this user.';
  }

  private chatUnavailableMessage(locale: 'zh-CN' | 'en'): string {
    return locale === 'zh-CN'
      ? '助手服务尚未配置'
      : 'Assistant service is not configured.';
  }

  private invalidConversationMessage(locale: 'zh-CN' | 'en'): string {
    return locale === 'zh-CN'
      ? '聊天消息列表的最后一条必须是非空的用户消息'
      : 'The last assistant conversation message must be a non-empty user message.';
  }
}
