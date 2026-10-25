import {
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { toDomainFailure } from '../services/provider-failures.js';
import type { ConversationView } from './conversation.js';
import { Injectable } from '@nestjs/common';
import type { AssistantCapabilitiesDataDto } from '../../adapters/http/dto/capabilities-response.dto.js';
import type { AssistantConversationDataDto } from '../../adapters/http/dto/conversation-response.dto.js';
import type { AssistantMessageDataDto } from '../../adapters/http/dto/stream-response.dto.js';
import type { StreamAssistantMessagesDto } from '../../adapters/http/dto/stream-messages.dto.js';
import type {
  AssistantConfirmResult,
  ConfirmAssistantProposalDto,
} from '../../adapters/http/dto/confirm-proposal.dto.js';
import { IUserSettingsPort } from '../../../user-settings/index.js';
import { AssistantPolicyService } from '../services/policy.js';
import { Conversations } from './conversation.js';
import { AssistantMemoryService } from '../services/memory.js';
import type { AssistantStreamChunkEvent } from '../ports/assistant.js';
import { AssistantProposalConfirmService } from './confirm-proposal.js';
import { AssistantStreamOrchestratorService } from './stream-message.js';

/**
 * Collapses a use-case `Outcome` (a plain promise) back into the
 * `ResultAsync` the transport expects. The use case returns a discriminated
 * value because its rules are domain vocabulary; the wire contract is a
 * `DomainFailure` (ADR-0012), and this is where the two meet.
 */
function settle(
  outcome: Promise<
    { ok: true; view: ConversationView } | { ok: false; failure: DomainFailure }
  >,
): ResultAsync<ConversationView, DomainFailure> {
  return fromPromise(outcome, (error) => toDomainFailure(error)).andThen(
    (result) =>
      result.ok ? okAsync(result.view) : errAsync(result.failure),
  );
}

@Injectable()
export class AssistantService {
  constructor(
    private readonly userSettingsService: IUserSettingsPort,
    private readonly assistantPolicyService: AssistantPolicyService,
    private readonly assistantConversationService: Conversations,
    private readonly assistantMemoryService: AssistantMemoryService,
    private readonly proposalConfirmService: AssistantProposalConfirmService,
    private readonly streamOrchestratorService: AssistantStreamOrchestratorService,
  ) {}

  getFoundationCapabilities() {
    return this.streamOrchestratorService.getFoundationCapabilities();
  }

  async getCapabilities(userId: string): Promise<AssistantCapabilitiesDataDto> {
    const foundation = this.getFoundationCapabilities();
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
      await this.assistantConversationService.latest(userId);
    return conversation == null ? null : conversation;
  }

  async listRecentConversations(userId: string) {
    return this.assistantConversationService.listRecent(userId);
  }

  openConversation(
    userId: string,
    conversationId: string,
  ): ResultAsync<AssistantConversationDataDto, DomainFailure> {
    return settle(
      this.assistantConversationService.open(userId, conversationId),
    );
  }

  async clearLatestConversation(userId: string): Promise<{
    cleared: boolean;
    archivedConversationId: string | null;
  }> {
    const archived =
      await this.assistantConversationService.archiveLatest(userId);
    return {
      cleared: archived.archivedConversationId != null,
      archivedConversationId: archived.archivedConversationId,
    };
  }

  renameConversation(
    userId: string,
    conversationId: string,
    title: string | null,
  ): ResultAsync<AssistantConversationDataDto, DomainFailure> {
    // A rename always carries a title; the DTO allows null because the
    // synchronous truncation can be absent for a turn with no user message.
    return settle(
      this.assistantConversationService.rename(
        userId,
        conversationId,
        title ?? '',
      ),
    );
  }

  deleteConversation(
    userId: string,
    conversationId: string,
  ): ResultAsync<AssistantConversationDataDto, DomainFailure> {
    return settle(
      this.assistantConversationService.remove(userId, conversationId),
    );
  }

  /**
   * Erases all persisted cross-conversation memories for the user (F-9
   * memory-erase entry point, used by the settings page). Deleting a single
   * conversation does not touch memory rows — that linkage is left for a
   * later task.
   */
  async clearAssistantMemory(userId: string): Promise<{ cleared: number }> {
    return this.assistantMemoryService.deleteAllForUser(userId);
  }

  confirmProposal(
    userId: string,
    conversationId: string,
    dto: ConfirmAssistantProposalDto,
  ): ResultAsync<AssistantConfirmResult, DomainFailure> {
    return this.proposalConfirmService.confirmProposal(
      userId,
      conversationId,
      dto,
      (uid, cid) => this.assistantConversationService.find(uid, cid),
    );
  }

  streamMessages(
    userId: string,
    dto: StreamAssistantMessagesDto,
    language: string,
    onChunk: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): ResultAsync<AssistantMessageDataDto, DomainFailure> {
    return this.streamOrchestratorService.streamMessages(
      userId,
      dto,
      language,
      onChunk,
    );
  }

  regenerateConversation(
    userId: string,
    conversationId: string,
    onChunk: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): ResultAsync<AssistantMessageDataDto, DomainFailure> {
    return this.streamOrchestratorService.regenerateConversation(
      userId,
      conversationId,
      onChunk,
      (uid, cid) => this.assistantConversationService.find(uid, cid),
    );
  }
}
