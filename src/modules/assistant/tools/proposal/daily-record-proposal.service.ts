import { formatDateOnly, now } from '../../../../common/index.js';
import { generatePrefixedId } from '../../../../common/index.js';
import { Inject, Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import type { IDailyRecordCandidateGenerator } from '../../types/ports.js';
import { DAILY_RECORD_CANDIDATE_GENERATOR } from '../../types/ports.js';
import type {
  AssistantCreateDailyRecordProposalPayload,
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
  AssistantUpdateDailyRecordProposalPayload,
} from '../../types/assistant.types.js';
import type { AssistantToolName } from '../shared/tool-types.js';
import { AssistantToolRecordQueryService } from '../records/query.service.js';
import {
  ASSISTANT_CREATE_RECORD_KINDS,
  DEFAULT_PROPOSAL_DATE_OFFSET_DAYS,
  PROPOSAL_TTL_MINUTES,
} from '../shared/tool-constants.js';
import { createAssistantTranslator } from '../shared/copy.js';
import {
  buildCreateRecordPreviewFields,
  buildProposalExpiryIso,
  buildUpdateRecordPreviewFields,
  describeCreateRecordSummary,
  describeDeleteRecordSummary,
  describeRecordTargetLabel,
  describeUpdateRecordSummary,
} from '../presenters.js';
import { extractRecordUpdateDraft } from './proposal-draft-extractor.js';

@Injectable()
export class AssistantDailyRecordProposalService {
  constructor(
    @Inject(DAILY_RECORD_CANDIDATE_GENERATOR)
    private readonly dailyRecordCandidatesService: IDailyRecordCandidateGenerator,
    private readonly recordQueryService: AssistantToolRecordQueryService,
    private readonly i18n: I18nService,
  ) {}

  async buildCreateDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    const t = createAssistantTranslator(this.i18n, context.locale);
    const occurredAtResolution = this.recordQueryService.resolveSingleDate(
      context.userMessage,
      {
        fallbackDate: this.offsetDateString(DEFAULT_PROPOSAL_DATE_OFFSET_DAYS),
        defaultAmbiguity:
          'No explicit date detected, so the draft defaults to today.',
      },
    );
    const candidates = await this.dailyRecordCandidatesService.generate(
      context.userId,
      {
        text: context.userMessage,
        occurredAt: occurredAtResolution.date,
      },
      context.locale,
    );
    const first = candidates.items[0];
    if (first == null) {
      return {
        name: toolName,
        data: {
          confirmationHint: candidates.confirmationHint,
          selectedDate: occurredAtResolution.date,
          ambiguities: occurredAtResolution.ambiguities,
          candidates: [],
        },
      };
    }

    // F-16: reject generation for a kind the assistant write path cannot
    // create, instead of silently downgrading it to a generic note. The
    // candidate generator normally emits only supported kinds, but a future
    // schema extension or a stray kind must surface as a refusal with the
    // offending kind attached for diagnostics.
    if (!ASSISTANT_CREATE_RECORD_KINDS.includes(first.kind)) {
      return {
        name: toolName,
        data: {
          confirmationHint: candidates.confirmationHint,
          selectedDate: occurredAtResolution.date,
          ambiguities: occurredAtResolution.ambiguities,
          candidates: candidates.items,
          unsupportedKind: first.kind,
          reason: t('proposal.reason.unsupported_kind'),
        },
      };
    }

    const payload: AssistantCreateDailyRecordProposalPayload = {
      type: 'create_daily_record',
      draft: {
        kind: first.kind,
        occurredAt: first.occurredAt,
        title: first.title,
        value: first.value,
        unit: first.unit,
        note: first.note,
        payload: first.payload,
      },
    };

    return {
      name: toolName,
      data: {
        confirmationHint: candidates.confirmationHint,
        selectedDate: occurredAtResolution.date,
        ambiguities: occurredAtResolution.ambiguities,
        candidateCount: candidates.items.length,
        candidates: candidates.items,
      },
      proposedActions: [
        {
          id: generatePrefixedId('proposal-create'),
          type: 'create_daily_record',
          status: 'proposed',
          confirmationRequired: true,
          title: t('proposal.create_record.title'),
          summary: describeCreateRecordSummary(first, t),
          reason: first.rationale,
          previewFields: buildCreateRecordPreviewFields(first, t),
          target: {
            kind: 'daily_record_draft',
            label: describeRecordTargetLabel(first, t),
            matchedBy: occurredAtResolution.matchedBy,
            snapshot: payload.draft,
          },
          constraints: [
            t('proposal.constraint.confirm_first'),
            t('proposal.constraint.create_scope'),
            t('proposal.constraint.create_regenerate'),
          ],
          expiresAt: buildProposalExpiryIso(PROPOSAL_TTL_MINUTES),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  async buildUpdateDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    const t = createAssistantTranslator(this.i18n, context.locale);
    const target =
      await this.recordQueryService.findTargetDailyRecordForMutation(context, {
        dateResolution: this.recordQueryService.resolveSingleDate(
          context.userMessage,
          {
            fallbackDate: this.todayDateString(),
            defaultAmbiguity:
              'No explicit date detected, so record matching defaulted to today.',
          },
        ),
      });
    const updateDraft = extractRecordUpdateDraft(context.userMessage);
    if (target.record == null || updateDraft == null) {
      return {
        name: toolName,
        data: {
          selectedDate: target.date,
          matchedRecord: target.record,
          matchedBy: target.matchedBy,
          ambiguities: target.ambiguities,
          confidence: target.confidence,
          reason: target.reason,
          candidateCount: target.candidateCount,
          draft: updateDraft,
        },
      };
    }
    const payload: AssistantUpdateDailyRecordProposalPayload = {
      type: 'update_daily_record',
      recordId: target.record.id,
      draft: updateDraft,
    };
    return {
      name: toolName,
      data: {
        selectedDate: target.date,
        matchedRecord: target.record,
        matchedBy: target.matchedBy,
        ambiguities: target.ambiguities,
        confidence: target.confidence,
        reason: target.reason,
        candidateCount: target.candidateCount,
        draft: updateDraft,
      },
      proposedActions: [
        {
          id: `proposal-update-${target.record.id}`,
          type: 'update_daily_record',
          status: 'proposed',
          confirmationRequired: true,
          title: t('proposal.update_record.title'),
          summary: describeUpdateRecordSummary(target.record, t),
          reason: target.reason,
          previewFields: buildUpdateRecordPreviewFields(updateDraft, t),
          target: {
            kind: 'daily_record',
            label: describeRecordTargetLabel(target.record, t),
            recordId: target.record.id,
            matchedBy: target.matchedBy,
            snapshot: target.record,
          },
          constraints: [
            t('proposal.constraint.confirm_first'),
            t('proposal.constraint.update_allowlist'),
            t('proposal.constraint.update_single'),
          ],
          expiresAt: buildProposalExpiryIso(PROPOSAL_TTL_MINUTES),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  async buildDeleteDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    const t = createAssistantTranslator(this.i18n, context.locale);
    const target =
      await this.recordQueryService.findTargetDailyRecordForMutation(context, {
        dateResolution: this.recordQueryService.resolveSingleDate(
          context.userMessage,
          {
            fallbackDate: this.todayDateString(),
            defaultAmbiguity:
              'No explicit date detected, so record matching defaulted to today.',
          },
        ),
      });
    if (target.record == null) {
      return {
        name: toolName,
        data: {
          selectedDate: target.date,
          matchedRecord: null,
          matchedBy: target.matchedBy,
          ambiguities: target.ambiguities,
          confidence: target.confidence,
          reason: target.reason,
          candidateCount: target.candidateCount,
        },
      };
    }
    const payload = {
      type: 'delete_daily_record',
      recordId: target.record.id,
    } as const;
    return {
      name: toolName,
      data: {
        selectedDate: target.date,
        matchedRecord: target.record,
        matchedBy: target.matchedBy,
        ambiguities: target.ambiguities,
        confidence: target.confidence,
        reason: target.reason,
        candidateCount: target.candidateCount,
      },
      proposedActions: [
        {
          id: `proposal-delete-${target.record.id}`,
          type: 'delete_daily_record',
          status: 'proposed',
          confirmationRequired: true,
          title: t('proposal.delete_record.title'),
          summary: describeDeleteRecordSummary(target.record, t),
          reason: target.reason,
          previewFields: [
            {
              label: t('preview.kind'),
              value: target.record.kind,
            },
            {
              label: t('preview.date'),
              value: target.record.occurredAt,
            },
            {
              label: t('preview.matched_by'),
              value: target.matchedBy.join(', '),
            },
          ],
          target: {
            kind: 'daily_record',
            label: describeRecordTargetLabel(target.record, t),
            recordId: target.record.id,
            matchedBy: target.matchedBy,
            snapshot: target.record,
          },
          constraints: [
            t('proposal.constraint.confirm_first_delete'),
            t('proposal.constraint.delete_single'),
            t('proposal.constraint.delete_refuse_guess'),
          ],
          expiresAt: buildProposalExpiryIso(PROPOSAL_TTL_MINUTES),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }

  private todayDateString(): string {
    return formatDateOnly(now());
  }

  private offsetDateString(offsetDays: number): string {
    const currentTime = now();
    const shifted = new Date(
      Date.UTC(
        currentTime.getUTCFullYear(),
        currentTime.getUTCMonth(),
        currentTime.getUTCDate() + offsetDays,
      ),
    );
    return formatDateOnly(shifted);
  }
}
