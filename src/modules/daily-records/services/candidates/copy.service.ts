import { Injectable } from '@nestjs/common';
import { LocalizedCopyService } from '../../../../common/services/localized-copy.service.js';
import type { DailyRecordCandidateData } from '../../dto/candidates/record-candidate-response.dto.js';
import type { DailyRecordCandidatesPromptCopy } from '../../prompts/daily-record-candidates.prompt.js';
import { nowIsoString } from '../../../../common/index.js';

@Injectable()
export class DailyRecordCandidatesCopyService extends LocalizedCopyService<DailyRecordCandidatesPromptCopy> {
  protected readonly scope = 'daily-record-candidates';

  confirmationHint(locale: string): string {
    return this.t(locale, 'confirmation_hint');
  }

  buildFallback(
    text: string,
    occurredAt: string,
    locale: string,
  ): DailyRecordCandidateData {
    return {
      locale,
      generatedAt: nowIsoString(),
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
}
