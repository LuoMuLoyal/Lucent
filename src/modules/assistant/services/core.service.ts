import {
  unwrapResult,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import { Injectable } from '@nestjs/common';
import type { AssistantCapabilitiesDataDto } from '../dto/capabilities-response.dto.js';
import type { AssistantConversationDataDto } from '../dto/conversation-response.dto.js';
import type { AssistantMessageDataDto } from '../dto/stream-response.dto.js';
import type { StreamAssistantMessagesDto } from '../dto/stream-messages.dto.js';
import type {
  AssistantConfirmResult,
  ConfirmAssistantProposalDto,
} from '../dto/confirm-proposal.dto.js';
import { IUserSettingsPort } from '../../user-settings/index.js';
import { AssistantPolicyService } from './policy.service.js';
import { AssistantConversationService } from './conversation.service.js';
import { AssistantMemoryService } from './memory.service.js';
import type { AssistantStreamChunkEvent } from '../types/assistant.types.js';
import { AssistantProposalConfirmService } from './proposal-confirm.service.js';
import { AssistantStreamOrchestratorService } from './stream-orchestrator.service.js';

@Injectable()
export class AssistantService {
  constructor(
    private readonly userSettingsService: IUserSettingsPort,
    private readonly assistantPolicyService: AssistantPolicyService,
    private readonly assistantConversationService: AssistantConversationService,
    private readonly assistantMemoryService: AssistantMemoryService,
    private readonly proposalConfirmService: AssistantProposalConfirmService,
    private readonly streamOrchestratorService: AssistantStreamOrchestratorService,
  ) {}

  async getFoundationCapabilities() {
    return this.streamOrchestratorService.getFoundationCapabilities();
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
    return this.proposalConfirmService.confirmProposal(
      userId,
      conversationId,
      dto,
      (uid, cid) => this.assistantConversationService.getConversation(uid, cid),
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
      (uid, cid) => this.assistantConversationService.getConversation(uid, cid),
    );
  }
}
