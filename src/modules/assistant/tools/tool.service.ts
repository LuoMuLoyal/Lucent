import { Injectable } from '@nestjs/common';
import type {
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
} from '../types/assistant.types';
import type { AssistantToolName } from './shared/tool-types';
import { AssistantToolLeafletReadService } from './leaflet/read.service';
import {
  AssistantToolDrugbankEntityResolveService,
  parseSearchPayload,
} from './drugbank/entity-resolve.service';
import { AssistantToolDrugbankSearchService } from './drugbank/search.service';
import { AssistantToolMedicalKnowledgeService } from './knowledge/medical.service';
import { AssistantToolMedicineLookupService } from './medicine/lookup.service';
import { AssistantToolProposalService } from './proposal/proposal.service';
import { AssistantToolReadService } from './read/read.service';

@Injectable()
export class AssistantToolService {
  constructor(
    private readonly readService: AssistantToolReadService,
    private readonly leafletReadService: AssistantToolLeafletReadService,
    private readonly medicalKnowledgeService: AssistantToolMedicalKnowledgeService,
    private readonly drugbankEntityResolveService: AssistantToolDrugbankEntityResolveService,
    private readonly drugbankSearchService: AssistantToolDrugbankSearchService,
    private readonly medicineLookupService: AssistantToolMedicineLookupService,
    private readonly proposalService: AssistantToolProposalService,
  ) {}

  async executeMany(
    context: AssistantToolExecutionContext,
    toolNames: readonly AssistantToolName[],
  ): Promise<AssistantToolExecutionResult[]> {
    const results: AssistantToolExecutionResult[] = [];
    for (const toolName of toolNames) {
      const toolContext = this.buildToolContext(context, toolName, results);
      results.push(await this.executeOne(toolContext, toolName));
    }
    return results;
  }

  private buildToolContext(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
    previousResults: readonly AssistantToolExecutionResult[],
  ): AssistantToolExecutionContext {
    if (toolName !== 'search_medicine_leaflets') {
      return context;
    }

    const productId = this.readResolvedCnProductId(previousResults);
    if (productId == null) {
      return context;
    }

    const payload = parseSearchPayload(context.userMessage);
    return {
      ...context,
      userMessage: JSON.stringify({
        query: payload.query,
        ...(payload.limit != null ? { limit: payload.limit } : {}),
        ...(payload.cursor != null ? { cursor: payload.cursor } : {}),
        filters: {
          ...payload.filters,
          productId,
        },
      }),
    };
  }

  private readResolvedCnProductId(
    results: readonly AssistantToolExecutionResult[],
  ): string | null {
    const detailResult = [...results]
      .reverse()
      .find((result) => result.name === 'get_cn_medicine_detail');
    const resultEnvelope = detailResult?.data['result'];
    if (resultEnvelope == null || typeof resultEnvelope !== 'object') {
      return null;
    }

    const product = (resultEnvelope as Record<string, unknown>)['product'];
    if (product == null || typeof product !== 'object') {
      return null;
    }

    const productId = (product as Record<string, unknown>)['id'];
    return typeof productId === 'string' && productId.trim().length > 0
      ? productId
      : null;
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
      case 'search_cn_medicine_products':
        return {
          name: toolName,
          data: await this.medicineLookupService.searchCnMedicineProducts(
            context,
          ),
        };
      case 'get_cn_medicine_detail':
        return {
          name: toolName,
          data: await this.medicineLookupService.getCnMedicineDetail(context),
        };
      case 'search_medicine_leaflets':
        return {
          name: toolName,
          data: await this.leafletReadService.searchMedicineLeaflets(context),
        };
      case 'search_medical_qa_corpus':
        return {
          name: toolName,
          data: await this.medicalKnowledgeService.searchMedicalQaCorpus(
            context,
          ),
        };
      case 'resolve_drugbank_entity':
        return {
          name: toolName,
          data: await this.drugbankEntityResolveService.resolve(context),
        };
      case 'get_drugbank_detail':
        return {
          name: toolName,
          data: await this.medicineLookupService.getDrugbankDetail(context),
        };
      case 'search_drugbank_passages':
        return {
          name: toolName,
          data: await this.drugbankSearchService.search(context),
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
