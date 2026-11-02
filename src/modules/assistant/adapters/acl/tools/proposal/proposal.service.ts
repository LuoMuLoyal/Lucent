import { Injectable } from '@nestjs/common';
import type {
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
} from '../../../../application/ports/assistant.js';
import type { ToolName } from '../../../../domain/policies/tool-permission.js';
import { AssistantDailyRecordProposalService } from './daily-record-proposal.service.js';
import { AssistantSettingsProposalService } from './settings-proposal.service.js';

/**
 * Facade over the daily-record and user-settings proposal builders.
 *
 * Kept as the single entry point for proposal construction so tool
 * implementations depend on one stable service while the two domains
 * (record drafts vs. settings drafts) live in focused services.
 */
@Injectable()
export class AssistantToolProposalService {
  constructor(
    private readonly dailyRecordProposalService: AssistantDailyRecordProposalService,
    private readonly settingsProposalService: AssistantSettingsProposalService,
  ) {}

  buildCreateDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: ToolName,
  ): Promise<AssistantToolExecutionResult> {
    return this.dailyRecordProposalService.buildCreateDailyRecordProposal(
      context,
      toolName,
    );
  }

  buildUpdateDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: ToolName,
  ): Promise<AssistantToolExecutionResult> {
    return this.dailyRecordProposalService.buildUpdateDailyRecordProposal(
      context,
      toolName,
    );
  }

  buildDeleteDailyRecordProposal(
    context: AssistantToolExecutionContext,
    toolName: ToolName,
  ): Promise<AssistantToolExecutionResult> {
    return this.dailyRecordProposalService.buildDeleteDailyRecordProposal(
      context,
      toolName,
    );
  }

  buildUpdateUserSettingsProposal(
    context: AssistantToolExecutionContext,
    toolName: ToolName,
  ): AssistantToolExecutionResult {
    return this.settingsProposalService.buildUpdateUserSettingsProposal(
      context,
      toolName,
    );
  }
}
