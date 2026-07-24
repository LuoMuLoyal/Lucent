import { Inject, Injectable } from '@nestjs/common';
import { DailyRecordKind } from '#generated/prisma/client';
import type { IDailyRecordReader } from '../../types/ports';
import { DAILY_RECORD_READER } from '../../types/ports';
import type { AssistantToolExecutionContext } from '../../types/assistant.types';
import { resolveSingleDate } from '../date-resolver';
import type {
  ToolMutationHints,
  ToolMutationRankedRecord,
  ToolMutationTargetMatch,
  ToolRecordItem,
  ToolSingleDateResolution,
} from '../constants';
import { MUTATION_MATCH_WEIGHTS } from '../constants';

@Injectable()
export class AssistantToolRecordQueryService {
  constructor(
    @Inject(DAILY_RECORD_READER)
    private readonly dailyRecordsService: IDailyRecordReader,
  ) {}

  async listToolRecords(
    userId: string,
    date: string,
    options: { includeSleep: boolean; sleepOnly?: boolean },
  ): Promise<ToolRecordItem[]> {
    const result = await this.dailyRecordsService.list(
      userId,
      date,
      undefined,
      1,
      100,
    );
    return result.items
      .filter((item) => {
        if (options.sleepOnly) {
          return item.kind === DailyRecordKind.sleep;
        }
        if (!options.includeSleep && item.kind === DailyRecordKind.sleep) {
          return false;
        }
        return true;
      })
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        occurredAt: item.occurredAt,
        title: item.title ?? null,
        value: item.value ?? null,
        unit: item.unit ?? null,
        note: item.note ?? null,
        tags: this.buildTags(item),
        payload: item.payload ?? null,
        mealAnalysisStatus: item.mealAnalysisStatus ?? null,
        mealAnalysisCoverage: item.mealAnalysisCoverage ?? null,
        mealAnalysisUpdatedAt: item.mealAnalysisUpdatedAt ?? null,
        mealAnalysisFailureReason: item.mealAnalysisFailureReason ?? null,
        mealShortDescription: item.mealShortDescription ?? null,
        mealTopFoods: item.mealTopFoods ?? [],
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }

  async findTargetDailyRecordForMutation(
    context: AssistantToolExecutionContext,
    input: {
      dateResolution: ToolSingleDateResolution;
      includeSleep?: boolean;
    },
  ): Promise<ToolMutationTargetMatch> {
    const records = await this.listToolRecords(
      context.userId,
      input.dateResolution.date,
      {
        includeSleep: input.includeSleep ?? true,
      },
    );
    const hints: ToolMutationHints = {
      kindHint: this.extractDailyRecordKindHint(context.userMessage),
      numericHint: this.extractNumericHint(context.userMessage),
      titleHint: this.extractQuotedOrTailHint(context.userMessage),
      noteHint: this.extractNoteHint(context.userMessage),
    };
    const ambiguities = [...input.dateResolution.ambiguities];
    const candidateCount = records.length;

    if (candidateCount === 0) {
      return {
        date: input.dateResolution.date,
        record: null,
        matchedBy: input.dateResolution.matchedBy,
        ambiguities,
        reason: 'No records exist on the selected date.',
        confidence: {
          level: 'low',
          reason:
            'Record mutation requires an existing record, but none were found on that date.',
        },
        candidateCount,
      };
    }

    if (
      hints.kindHint == null &&
      hints.numericHint == null &&
      hints.titleHint == null &&
      hints.noteHint == null
    ) {
      ambiguities.push(
        'Missing a stable record identifier. Use a kind plus value, a quoted title, or a note fragment.',
      );
      return {
        date: input.dateResolution.date,
        record: null,
        matchedBy: input.dateResolution.matchedBy,
        ambiguities,
        reason:
          'The request did not include enough detail to identify one record safely.',
        confidence: {
          level: 'low',
          reason:
            'Update/delete proposals are withheld unless the target record can be identified with high confidence.',
        },
        candidateCount,
      };
    }

    const ranked = records
      .map((record, index) => this.rankMutationTarget(record, hints, index))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);

    const top = ranked[0];
    const second = ranked[1];
    if (top == null) {
      ambiguities.push(
        'The message hints did not match any existing record on the selected date.',
      );
      return {
        date: input.dateResolution.date,
        record: null,
        matchedBy: input.dateResolution.matchedBy,
        ambiguities,
        reason: 'No record matched the described kind/value/title/note hints.',
        confidence: {
          level: 'low',
          reason: 'No candidate record satisfied the requested mutation hints.',
        },
        candidateCount,
      };
    }

    const strongSignals = top.matchedBy.filter(
      (item) => item === 'value' || item === 'title' || item === 'note',
    );
    const hasStrongSignals = strongSignals.length > 0;
    const isSingleCandidateWithKind =
      candidateCount === 1 &&
      hints.kindHint != null &&
      top.matchedBy.includes('kind');
    const scoreGap =
      second == null ? Number.POSITIVE_INFINITY : top.score - second.score;

    if (!hasStrongSignals && !isSingleCandidateWithKind) {
      ambiguities.push(
        'Kind alone is not specific enough to mutate a record safely.',
      );
      return {
        date: input.dateResolution.date,
        record: null,
        matchedBy: [...input.dateResolution.matchedBy, ...top.matchedBy],
        ambiguities,
        reason: 'The best match is still too broad to modify safely.',
        confidence: {
          level: 'low',
          reason:
            'High-constraint mutation proposals require a stronger identifier than kind alone.',
        },
        candidateCount,
      };
    }

    if (scoreGap < 4) {
      ambiguities.push(
        'More than one record matched too closely, so no mutation proposal was created.',
      );
      return {
        date: input.dateResolution.date,
        record: null,
        matchedBy: [...input.dateResolution.matchedBy, ...top.matchedBy],
        ambiguities,
        reason:
          'Multiple nearby records remain too similar to distinguish safely.',
        confidence: {
          level: 'low',
          reason:
            'The highest-ranked candidate was not separated enough from the next candidate.',
        },
        candidateCount,
      };
    }

    return {
      date: input.dateResolution.date,
      record: top.record,
      matchedBy: [...input.dateResolution.matchedBy, ...top.matchedBy],
      ambiguities,
      reason: hasStrongSignals
        ? 'Matched one existing record with specific value/title/note evidence.'
        : 'Matched the only record on that date for the requested kind.',
      confidence: {
        level: hasStrongSignals ? 'high' : 'medium',
        reason: hasStrongSignals
          ? 'The target record was separated by specific user-provided hints.'
          : 'Only one record existed for the requested kind on the selected date.',
      },
      candidateCount,
    };
  }

  resolveSingleDate(
    userMessage: string,
    input: {
      fallbackDate: string;
      defaultAmbiguity: string;
    },
  ): ToolSingleDateResolution {
    return resolveSingleDate(userMessage, input);
  }

  private rankMutationTarget(
    record: ToolRecordItem,
    hints: ToolMutationHints,
    index: number,
  ): ToolMutationRankedRecord {
    const matchedBy: string[] = [];
    let score = 0;

    if (hints.kindHint != null) {
      if (record.kind !== hints.kindHint) {
        return { record, score: 0, matchedBy };
      }
      matchedBy.push('kind');
      score += MUTATION_MATCH_WEIGHTS.kind;
    }

    if (hints.numericHint != null && record.value === hints.numericHint) {
      matchedBy.push('value');
      score += MUTATION_MATCH_WEIGHTS.value;
    }

    if (
      hints.titleHint != null &&
      record.title != null &&
      record.title.toLowerCase().includes(hints.titleHint.toLowerCase())
    ) {
      matchedBy.push('title');
      score += MUTATION_MATCH_WEIGHTS.title;
    }

    if (
      hints.noteHint != null &&
      record.note != null &&
      record.note.toLowerCase().includes(hints.noteHint.toLowerCase())
    ) {
      matchedBy.push('note');
      score += MUTATION_MATCH_WEIGHTS.note;
    }

    if (matchedBy.length === 0 && hints.kindHint == null) {
      return { record, score: 0, matchedBy };
    }

    score += Math.max(0, MUTATION_MATCH_WEIGHTS.positionBonus - index);
    return { record, score, matchedBy };
  }

  private extractDailyRecordKindHint(userMessage: string): string | null {
    if (/喝水|饮水|water/i.test(userMessage)) {
      return DailyRecordKind.water;
    }
    if (/吃饭|饮食|meal/i.test(userMessage)) {
      return DailyRecordKind.meal;
    }
    if (/症状|头痛|不舒服|symptom/i.test(userMessage)) {
      return DailyRecordKind.symptom;
    }
    if (/备注|自定义|note/i.test(userMessage)) {
      return DailyRecordKind.note;
    }
    if (/睡眠|睡觉|sleep/i.test(userMessage)) {
      return DailyRecordKind.sleep;
    }
    return null;
  }

  private extractNumericHint(userMessage: string): string | null {
    const match = userMessage.match(
      /\b(\d+(?:\.\d+)?)\s*(ml|毫升|cup|cups|杯|次)?/i,
    );
    return match?.[1] != null ? match[1].trim() : null;
  }

  private extractQuotedOrTailHint(userMessage: string): string | null {
    const quoted = userMessage.match(/["“](.+?)["”]/);
    if (quoted?.[1] != null) {
      return quoted[1].trim();
    }
    const tail = userMessage.match(
      /(?:标题|title|那条|这条)\s*[:：]?\s*(.+)$/i,
    );
    return tail?.[1] != null ? tail[1].trim() : null;
  }

  private extractNoteHint(userMessage: string): string | null {
    const noteMatch = userMessage.match(
      /(?:备注|note|内容|content)\s*[:：]?\s*(.+)$/i,
    );
    return noteMatch?.[1] != null ? noteMatch[1].trim() : null;
  }

  private buildTags(item: {
    kind: DailyRecordKind;
    mealAnalysisStatus?: string | null;
    mealAnalysisCoverage?: string | null;
  }): string[] {
    if (item.kind !== DailyRecordKind.meal) {
      return [];
    }

    const tags: string[] = [];
    if (item.mealAnalysisStatus != null) {
      tags.push(`meal_estimate:${item.mealAnalysisStatus}`);
    }
    if (item.mealAnalysisCoverage != null) {
      tags.push(`meal_coverage:${item.mealAnalysisCoverage}`);
    }
    return tags;
  }
}
