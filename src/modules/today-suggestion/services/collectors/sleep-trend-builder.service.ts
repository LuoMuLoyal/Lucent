import { Injectable } from '@nestjs/common';
import { now } from '../../../../common/index.js';
import type { DailyRecordFact } from '../../../daily-records/index.js';
import type { ObservedMetric } from '../../../../common/index.js';

type SleepEpisode = {
  sleepType: 'nightSleep' | 'nap';
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number;
  quality: string | null;
  recordId: string;
};

type ParsedSleepEpisode = SleepEpisode & {
  startMs: number | null;
  endMs: number | null;
};

export interface SleepSummary {
  episodes: SleepEpisode[];
  nightDurationMinutes: number;
  napDurationMinutes: number;
  allSleepDurationMinutes: number;
  observedMetric: ObservedMetric<number>;
  dataQualityWarnings: string[];
}

/**
 * Builds sleep summaries and multi-day sleep trends from daily-record facts.
 *
 * Extracted from `RecordCollectorService` to isolate the episode-parsing,
 * duration-aggregation, and overlap-detection logic from the broader
 * record-collector orchestration.
 */
@Injectable()
export class SleepTrendBuilderService {
  buildSleepSummary(records: DailyRecordFact[]): SleepSummary {
    const parsedEpisodes = records
      .map((record) => this.parseSleepEpisode(record))
      .filter((episode): episode is ParsedSleepEpisode => episode != null);
    const episodes = parsedEpisodes.map(
      ({ startMs: _startMs, endMs: _endMs, ...episode }) => episode,
    );
    const nightDurationMinutes = parsedEpisodes
      .filter((episode) => episode.sleepType === 'nightSleep')
      .reduce((sum, episode) => sum + episode.durationMinutes, 0);
    const napDurationMinutes = parsedEpisodes
      .filter((episode) => episode.sleepType === 'nap')
      .reduce((sum, episode) => sum + episode.durationMinutes, 0);
    const allSleepDurationMinutes = nightDurationMinutes + napDurationMinutes;
    const dataQualityWarnings: string[] = [];

    for (let index = 0; index < parsedEpisodes.length; index += 1) {
      const left = parsedEpisodes[index];
      if (left?.startMs == null || left.endMs == null) continue;
      for (
        let nextIndex = index + 1;
        nextIndex < parsedEpisodes.length;
        nextIndex += 1
      ) {
        const right = parsedEpisodes[nextIndex];
        if (
          right?.startMs != null &&
          right.endMs != null &&
          left.startMs < right.endMs &&
          right.startMs < left.endMs
        ) {
          dataQualityWarnings.push('sleep_episode_overlap');
          break;
        }
      }
      if (dataQualityWarnings.length > 0) break;
    }

    const windowStart = records[0]?.occurredAt ?? now();
    const windowEnd = new Date(windowStart);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);
    return {
      episodes,
      nightDurationMinutes,
      napDurationMinutes,
      allSleepDurationMinutes,
      observedMetric: {
        value: parsedEpisodes.length > 0 ? allSleepDurationMinutes : null,
        state: parsedEpisodes.length > 0 ? 'observed' : 'unknown',
        coverage: parsedEpisodes.length > 0 ? 'sufficient' : 'none',
        sources: parsedEpisodes.length > 0 ? ['manual'] : [],
        observedCount: parsedEpisodes.length,
        expectedCount: null,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
      },
      dataQualityWarnings,
    };
  }

  buildSleepTrend(
    records: DailyRecordFact[],
  ): Array<{ date: string; durationMinutes: number }> {
    const byDate = new Map<string, DailyRecordFact[]>();
    for (const record of records) {
      const date = record.occurredAt.toISOString().slice(0, 10);
      const dayRecords = byDate.get(date) ?? [];
      dayRecords.push(record);
      byDate.set(date, dayRecords);
    }

    return Array.from(byDate.entries())
      .map(([date, dayRecords]) => ({
        date,
        durationMinutes:
          this.buildSleepSummary(dayRecords).allSleepDurationMinutes,
      }))
      .filter((entry) => entry.durationMinutes > 0);
  }

  private parseSleepEpisode(
    record: DailyRecordFact,
  ): ParsedSleepEpisode | null {
    const payload = record.payload as Record<string, unknown> | null;
    if (payload == null) return null;

    const sleepType = payload['sleepType'] === 'nap' ? 'nap' : 'nightSleep';
    const startedAt = this.stringOrNull(
      payload['startedAt'] ?? payload['startAt'],
    );
    const endedAt = this.stringOrNull(payload['endedAt'] ?? payload['endAt']);
    const startMs = this.parseTimestamp(startedAt);
    const endMs = this.parseTimestamp(endedAt);
    const durationValue = payload['durationMinutes'];
    const durationMinutes =
      typeof durationValue === 'number' &&
      Number.isFinite(durationValue) &&
      durationValue > 0
        ? durationValue
        : startMs != null && endMs != null && endMs > startMs
          ? Math.round((endMs - startMs) / 60_000)
          : null;
    if (durationMinutes == null) return null;

    return {
      sleepType,
      startedAt,
      endedAt,
      durationMinutes,
      quality: this.stringOrNull(payload['quality']),
      recordId: record.id,
      startMs,
      endMs,
    };
  }

  private stringOrNull(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private parseTimestamp(value: string | null): number | null {
    if (value == null) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
}
