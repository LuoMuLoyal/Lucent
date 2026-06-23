import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import {
  buildLocalizedAiPromptCopy,
  resolveAiLocale,
  translateAiScopedCopy,
} from '../../../common/ai/ai-copy';
import type { DailyRecordCandidateData } from '../dto/daily-record-candidate-response.dto';
import type { DailyRecordCandidatesPromptCopy } from '../prompts/daily-record-candidates.prompt';

const DAILY_RECORD_CANDIDATES_COPY_SCOPE = 'daily-record-candidates';

@Injectable()
export class DailyRecordCandidatesCopyService {
  constructor(private readonly i18n: I18nService) {}

  resolveLocale(language: string | undefined): string {
    return resolveAiLocale(language);
  }

  serviceUnavailable(locale: string): string {
    return this.t(locale, 'service_unavailable');
  }

  confirmationHint(locale: string): string {
    return this.t(locale, 'confirmation_hint');
  }

  buildPromptCopy(locale: string): DailyRecordCandidatesPromptCopy {
    return buildLocalizedAiPromptCopy(
      this.i18n,
      DAILY_RECORD_CANDIDATES_COPY_SCOPE,
      locale,
    );
  }

  buildFallback(
    text: string,
    occurredAt: string,
    locale: string,
  ): DailyRecordCandidateData {
    return {
      locale,
      generatedAt: new Date().toISOString(),
      confirmationHint: this.confirmationHint(locale),
      items: [
        {
          kind: 'note',
          occurredAt,
          title: this.t(locale, 'fallback.note_title'),
          value: null,
          unit: null,
          note: text.trim(),
          payload: null,
          rationale: this.t(locale, 'fallback.note_rationale'),
        },
      ],
    };
  }

  private t(
    locale: string,
    key: string,
    args?: Record<string, string | number>,
  ): string {
    return translateAiScopedCopy(
      this.i18n,
      DAILY_RECORD_CANDIDATES_COPY_SCOPE,
      locale,
      key,
      args,
    );
  }
}
