import {
  createDomainFailure,
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import { DomainFailureException } from '../../../common/result/domain-failure.exception.js';
import { Injectable, Logger } from '@nestjs/common';
import type {
  AssistantMessageDataDto,
  AssistantToolDetailDto,
} from '../dto/stream-response.dto.js';
import type { StreamAssistantMessagesDto } from '../dto/stream-messages.dto.js';
import type { AssistantRuntimeCapabilities } from '../types/assistant.types.js';
import { AssistantRuntimeService } from '../agent/runtime.service.js';
import { IUserSettingsPort } from '../../user-settings/index.js';
import { AssistantPolicyService } from './policy.service.js';
import { AssistantToolService } from '../tools/tool.service.js';
import { AssistantConversationService } from './conversation.service.js';
import { nowIsoString } from '../../../common/index.js';
import type {
  AssistantConversationMessage,
  AssistantMessageResult,
  AssistantStreamChunkEvent,
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
} from '../types/assistant.types.js';
import type { AssistantToolName } from '../tools/shared/tool-types.js';
import {
  assistantToolDetailDataSchema,
  type AssistantToolDetailData,
} from '../schemas/tool-detail.schema.js';

/**
 * SSE streaming orchestration for assistant messages (normal + regenerate).
 *
 * Extracted from `AssistantService`: owns the pre-flight gate checks, the
 * tool-loop invocation, content fallback streaming and persistence of a turn.
 */
@Injectable()
export class AssistantStreamOrchestratorService {
  private readonly logger = new Logger(AssistantStreamOrchestratorService.name);

  constructor(
    private readonly assistantAgentService: AssistantRuntimeService,
    private readonly userSettingsService: IUserSettingsPort,
    private readonly assistantPolicyService: AssistantPolicyService,
    private readonly assistantToolExecutor: AssistantToolService,
    private readonly assistantConversationService: AssistantConversationService,
  ) {}

  async getFoundationCapabilities(): Promise<AssistantRuntimeCapabilities> {
    return this.assistantAgentService.describeFoundation();
  }

  streamMessages(
    userId: string,
    dto: StreamAssistantMessagesDto,
    language: string,
    onChunk: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): ResultAsync<AssistantMessageDataDto, DomainFailure> {
    return fromPromise(
      this.doStreamMessages(userId, dto, language, onChunk),
      (error) => this.toDomainFailure(error),
    );
  }

  private async doStreamMessages(
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
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'authorization',
          code: 'FORBIDDEN',
          detail: this.chatDisabledMessage(locale),
        }),
      );
    }

    if (!foundation.chatModelConfigured) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'dependency',
          code: 'DEPENDENCY_UNAVAILABLE',
          detail: this.chatUnavailableMessage(locale),
        }),
      );
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
   * Regenerates the last assistant message of a persisted conversation
   * (F-5b) using LangGraph time travel: replays the `respond` node from the
   * recorded checkpoint and streams a fresh answer. The old answer stays in
   * the conversation as a revision; the new answer is persisted as a new
   * assistant message.
   */
  regenerateConversation(
    userId: string,
    conversationId: string,
    onChunk: (event: AssistantStreamChunkEvent) => void | Promise<void>,
    getConversation: (
      userId: string,
      conversationId: string,
    ) => Promise<{ id: string } | null>,
  ): ResultAsync<AssistantMessageDataDto, DomainFailure> {
    return fromPromise(
      this.doRegenerateConversation(
        userId,
        conversationId,
        onChunk,
        getConversation,
      ),
      (error) => this.toDomainFailure(error),
    );
  }

  private async doRegenerateConversation(
    userId: string,
    conversationId: string,
    onChunk: (event: AssistantStreamChunkEvent) => void | Promise<void>,
    getConversation: (
      userId: string,
      conversationId: string,
    ) => Promise<{ id: string } | null>,
  ): Promise<AssistantMessageDataDto> {
    const conversation = await getConversation(userId, conversationId);
    if (conversation == null) {
      throw new DomainFailureException(this.conversationNotFound());
    }

    const { checkpointId } = await this.assistantAgentService
      .regenerateLastMessage(userId, conversationId)
      .match(
        (value) => value,
        (error) => {
          throw new DomainFailureException(error);
        },
      );

    const { finalContent } =
      await this.assistantAgentService.replayFromCheckpoint(
        conversationId,
        checkpointId,
        (text) => onChunk({ content: text }),
      );

    await this.assistantConversationService.appendAssistantMessage(
      userId,
      conversationId,
      finalContent,
    );

    return {
      conversationId,
      role: 'assistant',
      content: finalContent,
      generatedAt: nowIsoString(),
      usedTools: [],
      proposedActions: [],
      toolDetails: [],
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
      const resultData = data['result'];
      const resultRecord: Record<string, unknown> | undefined =
        resultData != null && typeof resultData === 'object'
          ? (resultData as Record<string, unknown>)
          : undefined;
      const parsed = assistantToolDetailDataSchema.safeParse({
        coverage: data['coverage'],
        confidence: data['confidence'],
        ambiguities: data['ambiguities'],
        source: data['source'],
        disclaimer:
          resultRecord != null && 'disclaimer' in resultRecord
            ? resultRecord['disclaimer']
            : undefined,
      });
      if (!parsed.success) {
        this.logger.warn(
          `Ignoring malformed tool detail metadata for tool "${result.name}".`,
          parsed.error,
        );
        return { name: result.name };
      }
      const detailData: AssistantToolDetailData = parsed.data;
      const { coverage, confidence, ambiguities, source, disclaimer } =
        detailData;
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

    throw new DomainFailureException(
      this.validation(this.invalidConversationMessage(locale)),
    );
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

  private toDomainFailure(error: unknown): DomainFailure {
    if (error instanceof DomainFailureException) {
      return error.failure;
    }
    throw error;
  }

  private conversationNotFound(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
      detail: 'Conversation not found.',
    });
  }

  private validation(detail: string): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
      detail,
    });
  }
}
