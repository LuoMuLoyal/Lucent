import { badRequest, forbidden, notFound } from '../../../common';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ResultCode } from '../../../common';
import type { AssistantCapabilitiesDataDto } from '../dto/capabilities-response.dto';

import type { AssistantConversationDataDto } from '../dto/conversation-response.dto';

import type {
  AssistantMessageDataDto,
  AssistantToolDetailDto,
} from '../dto/stream-response.dto';

import type { StreamAssistantMessagesDto } from '../dto/stream-messages.dto';
import type {
  AssistantConfirmResultDto,
  ConfirmAssistantProposalDto,
} from '../dto/confirm-proposal.dto';
import type { AssistantRuntimeCapabilities } from '../types/assistant.types';
import { AssistantRuntimeService } from '../agent/runtime.service';
import { UserSettingsService } from '../../user-settings';
import { AssistantPolicyService } from './policy.service';
import { AssistantToolService } from '../tools/tool.service';
import { AssistantConversationService } from './conversation.service';
import { nowIsoString } from '../../../common';
import type {
  AssistantConversationMessage,
  AssistantMessageResult,
  AssistantStreamChunkEvent,
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
} from '../types/assistant.types';
import type { AssistantToolName } from '../tools/shared/tool-types';

@Injectable()
export class AssistantService {
  constructor(
    private readonly assistantAgentService: AssistantRuntimeService,
    private readonly userSettingsService: UserSettingsService,
    private readonly assistantPolicyService: AssistantPolicyService,
    private readonly assistantToolExecutor: AssistantToolService,
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

  async confirmProposal(
    userId: string,
    conversationId: string,
    dto: ConfirmAssistantProposalDto,
  ): Promise<AssistantConfirmResultDto> {
    const conversation =
      await this.assistantConversationService.getConversation(
        userId,
        conversationId,
      );
    if (conversation == null) {
      notFound('Conversation not found.');
    }

    const { finalContent } =
      await this.assistantAgentService.resumeConversation({
        userId,
        conversationId,
        decision: dto.decision,
        ...(dto.note != null ? { note: dto.note } : {}),
      });
    return {
      conversationId,
      decision: dto.decision,
      status: dto.decision,
      finalContent,
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
        memoryEnabled: settings.assistantMemoryEnabled,
        isNewConversation: this.isNewConversation(messages),
        ...(dto.conversationId != null
          ? { conversationId: dto.conversationId }
          : {}),
        buildMemoryBlock: (id) =>
          this.assistantConversationService.buildMemoryBlock(id),
      },
      async (toolNames) => {
        const executable = toolNames.filter((name) =>
          policy.executableToolNames.includes(name),
        );
        return this.assistantToolExecutor.executeMany(toolContext, executable);
      },
      onChunk,
    );

    let result: AssistantMessageResult;
    if (conversationResult.finalContent != null) {
      result = conversationResult.streamedContent
        ? {
            content: conversationResult.finalContent,
            usedToolNames: conversationResult.toolResults.map(
              (toolResult) => toolResult.name,
            ),
          }
        : await this.assistantAgentService.streamPreGeneratedContent(
            conversationResult.finalContent,
            conversationResult.toolResults,
            onChunk,
          );
    } else {
      // Fallback when the graph produced no final content: stream a fresh
      // reply from the original conversation messages. Memory and tool
      // context injection now live inside the graph (`prepare_context` /
      // ToolMessage appends), so no extra context is assembled here.
      result = await this.assistantAgentService.generateStream(
        {
          locale,
          messages,
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
      toolDetails: this.buildToolDetails(conversationResult.toolResults),
    };
  }

  /**
   * Projects tool execution envelopes into the SSE result payload for the
   * client source strip. Only fields that actually exist in the envelope data
   * are included; the field is optional and absent for older messages.
   */
  private buildToolDetails(
    results: AssistantToolExecutionResult[],
  ): AssistantToolDetailDto[] {
    return results.map((result) => {
      const data = result.data;
      const coverage =
        typeof data['coverage'] === 'object' && data['coverage'] != null
          ? (data['coverage'] as {
              status: 'complete' | 'partial' | 'empty';
              reason: string | null;
            })
          : undefined;
      const confidence =
        typeof data['confidence'] === 'object' && data['confidence'] != null
          ? (data['confidence'] as {
              level: 'high' | 'medium' | 'low';
              reason: string;
            })
          : undefined;
      const ambiguities = Array.isArray(data['ambiguities'])
        ? (data['ambiguities'] as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : undefined;
      const source =
        typeof data['source'] === 'object' && data['source'] != null
          ? (data['source'] as {
              tool: string;
              generatedAt: string;
              tables: string[];
            })
          : undefined;
      const resultData = data['result'];
      const disclaimer =
        typeof resultData === 'object' &&
        resultData != null &&
        typeof (resultData as Record<string, unknown>)['disclaimer'] ===
          'string'
          ? ((resultData as Record<string, unknown>)['disclaimer'] as string)
          : undefined;
      const label = this.extractToolLabel(result.name, data);

      const detail: AssistantToolDetailDto = { name: result.name };
      if (label != null) detail.label = label;
      if (coverage != null) detail.coverage = coverage;
      if (confidence != null) detail.confidence = confidence;
      if (ambiguities != null && ambiguities.length > 0) {
        detail.ambiguities = ambiguities;
      }
      if (source != null) detail.source = source;
      if (disclaimer != null) detail.disclaimer = disclaimer;
      return detail;
    });
  }

  private extractToolLabel(
    name: AssistantToolName,
    data: Record<string, unknown>,
  ): string | null {
    switch (name) {
      case 'search_medicine_leaflets':
        return (
          this.readNestedString(data, ['result', 'resolvedProduct', 'name']) ??
          this.readNestedString(data, ['result', 'medicine', 'name'])
        );
      case 'search_drugbank_passages':
        return this.readNestedString(data, [
          'result',
          'passages',
          0,
          'drugName',
        ]);
      case 'resolve_drugbank_entity':
        return this.readNestedString(data, ['result', 'entities', 0, 'name']);
      default:
        return null;
    }
  }

  private readNestedString(
    data: Record<string, unknown>,
    path: Array<string | number>,
  ): string | null {
    let current: unknown = data;
    for (const key of path) {
      if (current == null || typeof current !== 'object') {
        return null;
      }
      current = (current as Record<string | number, unknown>)[key];
    }
    return typeof current === 'string' ? current : null;
  }

  private normalizeConversation(
    dto: StreamAssistantMessagesDto,
  ): AssistantConversationMessage[] {
    return dto.messages.map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));
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
