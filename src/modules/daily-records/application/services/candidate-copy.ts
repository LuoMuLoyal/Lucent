import { Injectable } from '@nestjs/common';
import { LocalizedCopyService } from '../../../../common/services/localized-copy.service.js';
import type { DailyRecordCandidateData } from '../ports/record-candidates.js';
import { CandidateCopyPort } from '../ports/candidate-generator.js';
import type { DailyRecordCandidatesPromptCopy } from './candidate-prompt.js';
import { nowIsoString } from '../../../../common/index.js';

@Injectable()
export class DailyRecordCandidatesCopyService
  extends LocalizedCopyService<DailyRecordCandidatesPromptCopy>
  implements CandidateCopyPort
{
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
