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
import { Injectable } from '@nestjs/common';
import { DailyRecordsService } from '../../daily-records/index.js';
import type {
  CreateDailyRecordDto,
  UpdateDailyRecordDto,
} from '../../daily-records/index.js';
import type {
  AssistantConfirmResult,
  ConfirmAssistantProposalDto,
} from '../dto/confirm-proposal.dto.js';
import { AssistantRuntimeService } from '../agent/runtime.service.js';
import { IUserSettingsPort } from '../../user-settings/index.js';
import type { AssistantProposedAction } from '../types/assistant.types.js';

/**
 * Applies approved HITL proposals and resumes the suspended conversation thread.
 *
 * Extracted from `AssistantService` to isolate the proposal-write switch/case
 * logic and the expiry-validation chain from the rest of the orchestration.
 */
@Injectable()
export class AssistantProposalConfirmService {
  constructor(
    private readonly assistantAgentService: AssistantRuntimeService,
    private readonly userSettingsService: IUserSettingsPort,
    private readonly dailyRecordsService: DailyRecordsService,
  ) {}

  confirmProposal(
    userId: string,
    conversationId: string,
    dto: ConfirmAssistantProposalDto,
    getConversation: (
      userId: string,
      conversationId: string,
    ) => Promise<{ id: string } | null>,
  ): ResultAsync<AssistantConfirmResult, DomainFailure> {
    return fromPromise(
      this.doConfirmProposal(userId, conversationId, dto, getConversation),
      (error) => this.toDomainFailure(error),
    );
  }

  private async doConfirmProposal(
    userId: string,
    conversationId: string,
    dto: ConfirmAssistantProposalDto,
    getConversation: (
      userId: string,
      conversationId: string,
    ) => Promise<{ id: string } | null>,
  ): Promise<AssistantConfirmResult> {
    const conversation = await getConversation(userId, conversationId);
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
