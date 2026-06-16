import { Injectable } from '@nestjs/common';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AIMessageChunk } from '@langchain/core/messages';
import { JsonOutputKeyToolsParser } from '@langchain/core/output_parsers/openai_tools';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { LlmRuntimeService } from '../../llm-runtime/llm-runtime.service';
import {
  buildReportSummarySystemPrompt,
  buildReportSummaryUserPrompt,
  type ReportSummaryPromptCopy,
} from './report-summary.prompt';
import type { ReportsAiSummaryContext } from './reports-ai-summary-context.service';
import {
  reportSummarySchema,
  type ReportSummaryStructuredOutput,
} from './report-summary.schema';

const REPORT_SUMMARY_TOOL_NAME = 'ReportSummary';
const MODEL_OPTIONS = {
  timeout: 10_000,
  temperature: 0.2,
  maxRetries: 0,
} as const;

@Injectable()
export class ReportsAiSummaryGeneratorService {
  constructor(private readonly llmRuntimeService: LlmRuntimeService) {}

  hasAnalysisModel(): boolean {
    return this.llmRuntimeService.hasRoleConfig('analysis');
  }

  async generate(
    context: ReportsAiSummaryContext,
    promptCopy: ReportSummaryPromptCopy,
  ): Promise<ReportSummaryStructuredOutput> {
    const model = this.createStructuredOutputModel();

    return model.invoke(this.buildMessages(context, promptCopy));
  }

  async generateStream(
    context: ReportsAiSummaryContext,
    promptCopy: ReportSummaryPromptCopy,
    onSummary: (summary: string) => void | Promise<void>,
  ): Promise<ReportSummaryStructuredOutput> {
    const model = this.createStreamingModel();
    const parser = new JsonOutputKeyToolsParser<ReportSummaryStructuredOutput>({
      keyName: REPORT_SUMMARY_TOOL_NAME,
      returnSingle: true,
      zodSchema: reportSummarySchema,
    });
    const stream = await model.stream(this.buildMessages(context, promptCopy));

    let accumulated: AIMessageChunk | undefined;
    let lastSummary = '';

    for await (const chunk of stream) {
      if (!(chunk instanceof AIMessageChunk)) {
        continue;
      }

      accumulated =
        accumulated === undefined ? chunk : accumulated.concat(chunk);
      const partial = (await parser.parsePartialResult([
        this.toGenerationChunk(accumulated),
      ])) as unknown;
      const summary = this.readSummary(partial);

      if (summary.trim().length > 0 && summary !== lastSummary) {
        lastSummary = summary;
        await onSummary(summary);
      }
    }

    if (accumulated === undefined) {
      throw new Error(
        'Report summary stream ended without any message chunks.',
      );
    }

    const result = (await parser.parseResult([
      this.toGenerationChunk(accumulated),
    ])) as unknown;
    if (result == null) {
      throw new Error(
        'Report summary stream ended without a structured result.',
      );
    }

    return reportSummarySchema.parse(result);
  }

  private createStructuredOutputModel() {
    return this.llmRuntimeService
      .createChatModel('analysis', MODEL_OPTIONS)
      .withStructuredOutput(reportSummarySchema, {
        name: REPORT_SUMMARY_TOOL_NAME,
        method: 'functionCalling',
        strict: true,
      });
  }

  private createStreamingModel() {
    const schema = toJsonSchema(reportSummarySchema);

    return this.llmRuntimeService
      .createChatModel('analysis', MODEL_OPTIONS)
      .withConfig({
        outputVersion: 'v0',
        tools: [
          {
            type: 'function',
            function: {
              name: REPORT_SUMMARY_TOOL_NAME,
              description:
                typeof schema.description === 'string'
                  ? schema.description
                  : '',
              parameters: schema,
            },
          },
        ],
        tool_choice: {
          type: 'function',
          function: { name: REPORT_SUMMARY_TOOL_NAME },
        },
        strict: true,
      });
  }

  private buildMessages(
    context: ReportsAiSummaryContext,
    promptCopy: ReportSummaryPromptCopy,
  ) {
    return [
      new SystemMessage(buildReportSummarySystemPrompt()),
      new HumanMessage(buildReportSummaryUserPrompt(context, promptCopy)),
    ];
  }

  private toGenerationChunk(message: AIMessageChunk): ChatGenerationChunk {
    return new ChatGenerationChunk({
      message,
      text: typeof message.content === 'string' ? message.content : '',
    });
  }

  private readSummary(partial: unknown): string {
    if (partial == null || typeof partial !== 'object') {
      return '';
    }

    const summary = (partial as { summary?: unknown }).summary;
    return typeof summary === 'string' ? summary : '';
  }
}
