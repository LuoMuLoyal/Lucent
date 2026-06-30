import { Injectable } from '@nestjs/common';
import {
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { JsonOutputKeyToolsParser } from '@langchain/core/output_parsers/openai_tools';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import type { ZodObject, ZodType } from 'zod';
import { LlmRuntimeService } from '../../modules/llm-runtime/services/llm-runtime.service';

type AiRole =
  | 'analysis'
  | 'vision'
  | 'language'
  | 'chat'
  | 'chatCompression'
  | 'embedding';

const MODEL_OPTIONS = {
  timeout: 10_000,
  temperature: 0.2,
  maxRetries: 0,
} as const;

export interface BaseAiGeneratorOptions {
  /** Name passed to the model as the function/tool name. */
  toolName: string;
  /** Human-readable name used in stream error messages. */
  streamName: string;
}

/**
 * Shared base for AI structured-output generators.
 *
 * Subclasses only need to supply the Zod schema, tool name, and prompt builders;
 * streaming and structured-output invocation are implemented once here.
 */
@Injectable()
export abstract class BaseAiGeneratorService<
  TContext,
  TPromptCopy,
  TOutput extends Record<string, unknown>,
> {
  protected abstract readonly schema: ZodType<TOutput>;
  protected abstract readonly options: BaseAiGeneratorOptions;
  /** AI model role to use (e.g. 'analysis', 'language'). */
  protected abstract readonly modelRole: AiRole;

  protected constructor(
    private readonly llmRuntimeService: LlmRuntimeService,
  ) {}

  hasAnalysisModel(): boolean {
    return this.llmRuntimeService.hasRoleConfig(this.modelRole);
  }

  async generate(context: TContext, promptCopy: TPromptCopy): Promise<TOutput> {
    const model = this.createStructuredOutputModel();

    return model.invoke(
      this.buildMessages(context, promptCopy),
    ) as Promise<TOutput>;
  }

  async generateStream(
    context: TContext,
    promptCopy: TPromptCopy,
    onSummary: (summary: string) => void | Promise<void>,
  ): Promise<TOutput> {
    const model = this.createStreamingModel();
    const parser = new JsonOutputKeyToolsParser<TOutput>({
      keyName: this.options.toolName,
      returnSingle: true,
      zodSchema: this.schema as never,
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
      ])) as unknown; // parsePartialResult returns a partial that doesn't conform to the full schema
      const summary = this.readSummary(partial);

      if (summary.trim().length > 0 && summary !== lastSummary) {
        lastSummary = summary;
        await onSummary(summary);
      }
    }

    if (accumulated === undefined) {
      throw new Error(
        `${this.options.streamName} stream ended without any message chunks.`,
      );
    }

    const result = (await parser.parseResult([
      this.toGenerationChunk(accumulated),
    ])) as unknown; // narrowed by this.schema.parse(result) below
    if (result == null) {
      throw new Error(
        `${this.options.streamName} stream ended without a structured result.`,
      );
    }

    return this.schema.parse(result);
  }

  protected abstract buildSystemPrompt(): string;
  protected abstract buildUserPrompt(
    context: TContext,
    promptCopy: TPromptCopy,
  ): string;

  private buildMessages(context: TContext, promptCopy: TPromptCopy) {
    return [
      new SystemMessage(this.buildSystemPrompt()),
      new HumanMessage(this.buildUserPrompt(context, promptCopy)),
    ];
  }

  private createStructuredOutputModel() {
    return this.llmRuntimeService
      .createChatModel(this.modelRole, MODEL_OPTIONS)
      .withStructuredOutput(this.schema, {
        name: this.options.toolName,
        method: 'functionCalling',
        strict: true,
      });
  }

  private createStreamingModel() {
    const schema = toJsonSchema(this.schema);

    return this.llmRuntimeService
      .createChatModel(this.modelRole, MODEL_OPTIONS)
      .withConfig({
        outputVersion: 'v0',
        tools: [
          {
            type: 'function',
            function: {
              name: this.options.toolName,
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
          function: { name: this.options.toolName },
        },
        strict: true,
      });
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

    const parsed = (this.schema as ZodObject<Record<string, ZodType>>)
      .partial()
      .safeParse(partial);
    if (!parsed.success) {
      return '';
    }

    const summary = parsed.data['summary'];
    return typeof summary === 'string' ? summary : '';
  }
}
