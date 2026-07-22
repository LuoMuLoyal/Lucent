/**
 * LLM-based copy generator for suggestion cards.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import {
  buildCopySystemPrompt,
  buildCopyUserPrompt,
  buildCopyFewShotExamples,
  type CopyGenerationOptions,
} from '../../prompts';
import { parseGeneratedCopy, type GeneratedCopy } from '../../schemas';

@Injectable()
export class CopyGeneratorService {
  private readonly logger = new Logger(CopyGeneratorService.name);
  private readonly llm: ChatOpenAI | null = null;
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const model = this.configService.get<string>(
      'COPY_GENERATION_MODEL',
      'gpt-4o-mini',
    );
    this.enabled = this.configService.get<boolean>(
      'COPY_GENERATION_ENABLED',
      true,
    );

    if (apiKey) {
      this.llm = new ChatOpenAI({
        apiKey,
        model,
        temperature: 0.7,
        maxTokens: 300,
      });
    } else {
      this.logger.warn(
        'OPENAI_API_KEY not configured, copy generation will use fallbacks',
      );
    }
  }

  /**
   * Generates copy using LLM.
   * Returns null if generation fails or is disabled.
   */
  async generate(
    templateKey: string,
    params: Record<string, string | number>,
    options: CopyGenerationOptions,
  ): Promise<GeneratedCopy | null> {
    if (!this.enabled || !this.llm) {
      return null;
    }

    try {
      const systemPrompt = buildCopySystemPrompt(options);
      const userPrompt = buildCopyUserPrompt(templateKey, params);
      const fewShotExamples = buildCopyFewShotExamples(options.locale);

      const response = await this.llm.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: fewShotExamples },
        { role: 'user', content: userPrompt },
      ]);

      const content = response.content as string;
      if (!content) {
        this.logger.warn('Empty response from LLM for copy generation');
        return null;
      }

      const parsed = JSON.parse(content) as unknown;
      return parseGeneratedCopy(parsed);
    } catch (error) {
      this.logger.error(
        `Copy generation failed for template ${templateKey}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  }

  /**
   * Checks if the generator is available (has API key and is enabled).
   */
  isAvailable(): boolean {
    return this.enabled && this.llm !== null;
  }
}
