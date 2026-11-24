import { Injectable } from '@nestjs/common';
import { LocalizedCopyService } from '../../../../common/services/localized-copy.service.js';
import type { RecordEntryCandidateData } from '../ports/record-candidates.js';
import { CandidateCopyPort } from '../ports/candidate-generator.js';
import type { RecordEntryCandidatesPromptCopy } from './candidate-prompt.js';
import { nowIsoString } from '../../../../common/index.js';

@Injectable()
export class RecordEntryCandidatesCopyService
  extends LocalizedCopyService<RecordEntryCandidatesPromptCopy>
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
  ): RecordEntryCandidateData {
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
