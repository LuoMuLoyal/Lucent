import { Injectable } from '@nestjs/common';
import type {
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
} from '../types/assistant.types';
import type { AssistantToolName } from './assistant-tool.types';
import { AssistantToolLeafletReadService } from './assistant-tool-leaflet-read.service';
import { AssistantToolMedicalKnowledgeService } from './assistant-tool-medical-knowledge.service';
import { AssistantToolProposalService } from './assistant-tool-proposal.service';
import { AssistantToolReadService } from './assistant-tool-read.service';

@Injectable()
export class AssistantToolService {
  constructor(
    private readonly readService: AssistantToolReadService,
    private readonly leafletReadService: AssistantToolLeafletReadService,
    private readonly medicalKnowledgeService: AssistantToolMedicalKnowledgeService,
    private readonly proposalService: AssistantToolProposalService,
  ) {}

  async executeMany(
    context: AssistantToolExecutionContext,
    toolNames: readonly AssistantToolName[],
  ): Promise<AssistantToolExecutionResult[]> {
    const results: AssistantToolExecutionResult[] = [];
    for (const toolName of toolNames) {
      results.push(await this.executeOne(context, toolName));
    }
    return results;
  }

  private async executeOne(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    switch (toolName) {
      case 'get_today_records':
        return {
          name: toolName,
          data: await this.readService.getTodayRecords(context),
        };
      case 'get_records_by_date':
        return {
          name: toolName,
          data: await this.readService.getRecordsByDate(context),
        };
      case 'get_records_by_range':
        return {
          name: toolName,
          data: await this.readService.getRecordsByRange(context),
        };
      case 'get_today_summary_by_date':
        return {
          name: toolName,
          data: await this.readService.getTodaySummaryByDate(context),
        };
      case 'get_report_summary_by_range':
        return {
          name: toolName,
          data: await this.readService.getReportSummaryByRange(context),
        };
      case 'get_recent_today_summaries':
        return {
          name: toolName,
          data: await this.readService.getRecentTodaySummaries(context),
        };
      case 'get_recent_report_summaries':
        return {
          name: toolName,
          data: await this.readService.getRecentReportSummaries(context),
        };
      case 'get_user_profile':
        return {
          name: toolName,
          data: await this.readService.getUserProfile(context),
        };
      case 'get_user_settings':
        return {
          name: toolName,
          data: await this.readService.getUserSettings(context),
        };
      case 'get_current_medicines':
        return {
          name: toolName,
          data: await this.readService.getCurrentMedicines(context),
        };
      case 'get_sleep_summary_by_range':
        return {
          name: toolName,
          data: await this.readService.getSleepSummaryByRange(context),
        };
      case 'get_medicine_leaflet_context':
        return {
          name: toolName,
          data: await this.leafletReadService.getMedicineLeafletContext(
            context,
          ),
        };
      case 'get_medical_knowledge':
        return {
          name: toolName,
          data: await this.medicalKnowledgeService.getMedicalKnowledge(context),
        };
      case 'propose_create_daily_record':
        return this.proposalService.buildCreateDailyRecordProposal(
          context,
          toolName,
        );
      case 'propose_update_daily_record':
        return this.proposalService.buildUpdateDailyRecordProposal(
          context,
          toolName,
        );
      case 'propose_delete_daily_record':
        return this.proposalService.buildDeleteDailyRecordProposal(
          context,
          toolName,
        );
      case 'propose_update_user_settings':
        return this.proposalService.buildUpdateUserSettingsProposal(
          context,
          toolName,
        );
    }
  }
}
