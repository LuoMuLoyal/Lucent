import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DailyRecordCandidateData } from '../../dto/candidates/record-candidate-response.dto';

import type { GenerateDailyRecordCandidatesDto } from '../../dto/candidates/generate-record-candidates.dto';
import { DailyRecordCandidatesCopyService } from '../candidates/copy.service';
import { DailyRecordCandidatesGeneratorService } from '../candidates/generator.service';
import { nowIsoString } from '../../../../common';
import { extractErrorInfo } from '../../../../common';

interface DailyRecordCandidatesContext {
  text: string;
  occurredAt: string;
  timezone: string | null;
}

@Injectable()
export class DailyRecordCandidatesService {
  private readonly logger = new Logger(DailyRecordCandidatesService.name);

  constructor(
    private readonly copyService: DailyRecordCandidatesCopyService,
    private readonly generatorService: DailyRecordCandidatesGeneratorService,
  ) {}

  async generate(
    userId: string,
    dto: GenerateDailyRecordCandidatesDto,
    language: string,
  ): Promise<DailyRecordCandidateData> {
    const locale = this.copyService.resolveLocale(language);

    if (!this.generatorService.hasAnalysisModel()) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: this.copyService.serviceUnavailable(locale),
      });
    }

    const context = this.buildContext(dto);

    try {
      const output = await this.generatorService.generate(
        context,
        this.copyService.buildPromptCopy(locale),
      );

      return {
        locale,
        generatedAt: nowIsoString(),
        confirmationHint: this.copyService.confirmationHint(locale),
        items: output.items,
      };
    } catch (error) {
      const { message: reason } = extractErrorInfo(error);
      this.logger.warn(
        `Daily record candidate generation failed for userId=${userId}, occurredAt=${dto.occurredAt}; falling back: ${reason}`,
      );

      return this.copyService.buildFallback(dto.text, dto.occurredAt, locale);
    }
  }

  private buildContext(
    dto: GenerateDailyRecordCandidatesDto,
  ): DailyRecordCandidatesContext {
    return {
      text: dto.text.trim(),
      occurredAt: dto.occurredAt,
      timezone: dto.timezone?.trim() || null,
    };
  }
}
