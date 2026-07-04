import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ResultCode } from '../../../common/api-envelope';
import type {
  DailyRecordCandidateData,
  GenerateDailyRecordCandidatesDto,
} from '../dto';
import { DailyRecordCandidatesCopyService } from './daily-record-candidates-copy.service';
import { DailyRecordCandidatesGeneratorService } from './daily-record-candidates-generator.service';
import { nowIsoString } from '../../../common/helpers/date-time.utils';

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
    dto: GenerateDailyRecordCandidatesDto,
    language: string,
  ): Promise<DailyRecordCandidateData> {
    const locale = this.copyService.resolveLocale(language);

    if (!this.generatorService.hasAnalysisModel()) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
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
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Daily record candidate generation failed for ${dto.occurredAt}; falling back: ${reason}`,
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
