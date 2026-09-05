import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  unwrapResult,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import { DomainFailureException } from '../../../common/result/domain-failure.exception.js';
import { Injectable, Logger } from '@nestjs/common';
import { DailyRecordsService } from '../../daily-records/index.js';
import type {
  CreateDailyRecordDto,
  UpdateDailyRecordDto,
} from '../../daily-records/index.js';
import type { AssistantCapabilitiesDataDto } from '../dto/capabilities-response.dto.js';

import type { AssistantConversationDataDto } from '../dto/conversation-response.dto.js';

import type {
  AssistantMessageDataDto,
  AssistantToolDetailDto,
} from '../dto/stream-response.dto.js';

import type { StreamAssistantMessagesDto } from '../dto/stream-messages.dto.js';
import type {
  AssistantConfirmResult,
  ConfirmAssistantProposalDto,
} from '../dto/confirm-proposal.dto.js';
import type { AssistantRuntimeCapabilities } from '../types/assistant.types.js';
import { AssistantRuntimeService } from '../agent/runtime.service.js';
import { IUserSettingsPort } from '../../user-settings/index.js';
import { AssistantPolicyService } from './policy.service.js';
import { AssistantToolService } from '../tools/tool.service.js';
import { AssistantConversationService } from './conversation.service.js';
import { AssistantMemoryService } from './memory.service.js';
import { nowIsoString } from '../../../common/index.js';
import type {
  AssistantConversationMessage,
  AssistantMessageResult,
  AssistantProposedAction,
  AssistantStreamChunkEvent,
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
} from '../types/assistant.types.js';
import type { AssistantToolName } from '../tools/shared/tool-types.js';
import {
  assistantToolDetailDataSchema,
  type AssistantToolDetailData,
} from '../schemas/tool-detail.schema.js';

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly assistantAgentService: AssistantRuntimeService,
    private readonly userSettingsService: IUserSettingsPort,
    private readonly assistantPolicyService: AssistantPolicyService,
    private readonly assistantToolExecutor: AssistantToolService,
    private readonly assistantConversationService: AssistantConversationService,
    private readonly dailyRecordsService: DailyRecordsService,
    private readonly assistantMemoryService: AssistantMemoryService,
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

  openConversation(
    userId: string,
    conversationId: string,
  ): ResultAsync<AssistantConversationDataDto, DomainFailure> {
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

  renameConversation(
    userId: string,
    conversationId: string,
    title: string | null,
  ): ResultAsync<AssistantConversationDataDto, DomainFailure> {
    return this.assistantConversationService.renameConversation(
      userId,
      conversationId,
      title,
    );
  }

  deleteConversation(
    userId: string,
    conversationId: string,
  ): ResultAsync<AssistantConversationDataDto, DomainFailure> {
    return this.assistantConversationService.deleteConversation(
      userId,
      conversationId,
    );
  }

  /**
   * Erases all persisted cross-conversation memories for the user (F-9
   * memory-erase entry point, used by the settings page). Deleting a single
   * conversation does not touch memory rows — that linkage is left for a
   * later task.
   */
  async clearAssistantMemory(userId: string): Promise<{ cleared: number }> {
    const cleared = await unwrapResult(
      this.assistantMemoryService.deleteAllForUser(userId),
    );
    return { cleared };
  }

  confirmProposal(
    userId: string,
    conversationId: string,
    dto: ConfirmAssistantProposalDto,
  ): ResultAsync<AssistantConfirmResult, DomainFailure> {
    return fromPromise(
      this.doConfirmProposal(userId, conversationId, dto),
      (error) => this.toDomainFailure(error),
    );
  }

  private async doConfirmProposal(
    userId: string,
    conversationId: string,
    dto: ConfirmAssistantProposalDto,
  ): Promise<AssistantConfirmResult> {
    const conversation =
      await this.assistantConversationService.getConversation(
        userId,
        conversationId,
      );
    if (conversation == null) {
      throw new DomainFailureException(this.conversationNotFound());
    }

    // On approval the writes are applied server-side from the suspended
    // thread's proposals BEFORE the thread is resumed. Any write failure
    // aborts the confirm (the thread stays suspended at the review point) and
    // surfaces to the client as a failed confirm — never "confirmed but not
    // written".
    if (dto.decision === 'approved') {
      await unwrapResult(
        this.applyApprovedProposals(userId, conversationId, dto.proposalIds),
      );
    }

    const { finalContent } = await unwrapResult(
      this.assistantAgentService.resumeConversation({
        userId,
        conversationId,
        decision: dto.decision,
        ...(dto.note != null ? { note: dto.note } : {}),
      }),
    );
    return {
      conversationId,
      decision: dto.decision,
      status: dto.decision,
      finalContent,
    };
  }

  /**
   * Applies the approved write proposals (only the ones the client explicitly
   * named that still exist in the thread state), in order, scoped to the
   * conversation owner. Revalidates the review state read from the checkpoint
   * so double-confirm behaves the same as resumeConversation.
   *
   * Expiry is validated per proposal (F-11): any approved proposal whose own
   * `expiresAt` is past due rejects the whole confirm, so a stale proposal can
   * never be written just because a sibling in the same batch is still fresh.
   */
  private applyApprovedProposals(
    userId: string,
    conversationId: string,
    proposalIds: string[],
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(
      this.assistantAgentService.readPendingProposals(conversationId),
      (error) => this.toDomainFailure(error),
    ).andThen(({ pendingReview, proposals }) => {
      if (pendingReview == null || pendingReview.status !== 'pending') {
        return errAsync(
          this.validation('No pending proposal review for this conversation.'),
        );
      }

      const toWrite = proposals.filter((proposal) =>
        proposalIds.includes(proposal.id),
      );
      if (toWrite.length === 0 && proposalIds.length > 0) {
        return errAsync(
          this.validation('Proposal not found in the pending review.'),
        );
      }

      const now = Date.now();
      if (
        toWrite.some((proposal) => new Date(proposal.expiresAt).getTime() < now)
      ) {
        return errAsync(
          this.validation(
            'The proposal review expired. Ask the assistant to regenerate it.',
          ),
        );
      }

      let chain: ResultAsync<void, DomainFailure> = okAsync(undefined);
      for (const proposal of toWrite) {
        chain = chain.andThen(() => this.applyProposalWrite(userId, proposal));
      }
      return chain;
    });
  }

  private applyProposalWrite(
    userId: string,
    proposal: AssistantProposedAction,
  ): ResultAsync<void, DomainFailure> {
    // The payload union is discriminated on its own `type` field; switching on
    // it narrows each payload variant below.
    switch (proposal.payload.type) {
      case 'create_daily_record': {
        const draft = proposal.payload.draft;
        const createDto: CreateDailyRecordDto = {
          // kind is generated-side bounded to the assistant kind union;
          // invalid values are rejected by the service's enum validation.
          kind: draft.kind,
          occurredAt: draft.occurredAt,
          ...(draft.title != null ? { title: draft.title } : {}),
          ...(draft.value != null ? { value: draft.value } : {}),
          ...(draft.unit != null ? { unit: draft.unit } : {}),
          ...(draft.note != null ? { note: draft.note } : {}),
          ...(draft.payload != null ? { payload: draft.payload } : {}),
        };
        return this.dailyRecordsService
          .create(userId, createDto)
          .map(() => undefined);
      }
      case 'update_daily_record': {
        const draft = proposal.payload.draft;
        // UpdateDailyRecordDto semantics: a key present with `null` clears
        // the field, an absent key leaves it unchanged. The draft carries
        // only the keys the assistant intended to change, so pass them
        // through verbatim (null values included). occurredAt is the
        // exception: the DTO does not allow null for it (a record always has
        // a date), so a null draft value is skipped.
        const updateDto: UpdateDailyRecordDto = {};
        if (draft.occurredAt != null) {
          updateDto.occurredAt = draft.occurredAt;
        }
        if (draft.title !== undefined) {
          updateDto.title = draft.title;
        }
        if (draft.value !== undefined) {
          updateDto.value = draft.value;
        }
        if (draft.unit !== undefined) {
          updateDto.unit = draft.unit;
        }
        if (draft.note !== undefined) {
          updateDto.note = draft.note;
        }
        if (draft.payload !== undefined) {
          updateDto.payload = draft.payload;
        }
        return this.dailyRecordsService
          .update(userId, proposal.payload.recordId, updateDto)
          .map(() => undefined);
      }
      case 'delete_daily_record':
        return this.dailyRecordsService
          .delete(userId, proposal.payload.recordId)
          .map(() => undefined);
      case 'update_user_settings': {
        const draft = proposal.payload.draft;
        return this.userSettingsService
          .updateSettings(userId, {
            ...(draft.assistantEnabled != null
              ? { assistantEnabled: draft.assistantEnabled }
              : {}),
            ...(draft.assistantMemoryEnabled != null
              ? { assistantMemoryEnabled: draft.assistantMemoryEnabled }
              : {}),
            ...(draft.assistantContext != null
              ? { assistantContext: draft.assistantContext }
              : {}),
          })
          .map(() => undefined);
      }
    }
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
  ): ResultAsync<AssistantMessageDataDto, DomainFailure> {
    return fromPromise(
      this.doRegenerateConversation(userId, conversationId, onChunk),
      (error) => this.toDomainFailure(error),
    );
  }

  private async doRegenerateConversation(
    userId: string,
    conversationId: string,
    onChunk: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): Promise<AssistantMessageDataDto> {
    const conversation =
      await this.assistantConversationService.getConversation(
        userId,
        conversationId,
      );
    if (conversation == null) {
      throw new DomainFailureException(this.conversationNotFound());
    }

    const { checkpointId } = await unwrapResult(
      this.assistantAgentService.regenerateLastMessage(userId, conversationId),
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
   * Converts a DomainFailureException raised inside the imperative body into
   * the Result Err; any other exception (LLM, program, config) is re-thrown
   * so it reaches the transport boundary unchanged.
   */
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
}
