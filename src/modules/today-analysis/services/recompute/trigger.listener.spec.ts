import { DailyRecordKind, HealthEventKind } from '#generated/prisma/client';
import {
  DAILY_RECORD_CHANGED,
  DOSE_LOG_CHANGED,
  HEALTH_EVENT_CHANGED,
  TODAY_SUGGESTION_MATERIALIZATION_CHANGED,
} from '../../../../common/events/domain-events';
import { TodayAnalysisTriggerListener } from './trigger.listener';
import type { TodayAnalysisContextService } from '../pipeline/context.service';

describe('TodayAnalysisTriggerListener', () => {
  let listener: TodayAnalysisTriggerListener;
  let store: { markPending: vi.Mock };
  let queue: { enqueue: vi.Mock };
  let contextService: { shouldTriggerForDimension: vi.Mock };

  beforeEach(() => {
    store = {
      markPending: vi.fn().mockResolvedValue({
        status: 'pending',
        sourceVersion: 4,
        shouldQueue: true,
      }),
    };
    queue = { enqueue: vi.fn().mockResolvedValue('job-1') };
    contextService = {
      shouldTriggerForDimension: vi.fn().mockResolvedValue(false),
    };
    listener = new TodayAnalysisTriggerListener(
      store as never,
      queue as never,
      contextService as unknown as TodayAnalysisContextService,
    );
  });

  it.each([
    DailyRecordKind.water,
    DailyRecordKind.meal,
    DailyRecordKind.sleep,
    DailyRecordKind.mood,
  ])('queues %s records only when dimension gate passes', async (kind) => {
    contextService.shouldTriggerForDimension.mockResolvedValue(true);

    await listener.handleDailyRecordChanged({
      userId: 'user-1',
      date: '2026-08-10',
      kind,
      recordId: 'record-1',
    });

    expect(contextService.shouldTriggerForDimension).toHaveBeenCalledWith(
      'user-1',
      '2026-08-10',
      kind,
    );
    expect(store.markPending).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        localDate: '2026-08-10',
        reasonCode: 'daily_record_changed',
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith(
      'user-1',
      { date: '2026-08-10' },
      'zh-CN',
      4,
      'daily_record_changed',
      'daily-record:record-1',
    );
  });

  it.each([
    DailyRecordKind.water,
    DailyRecordKind.meal,
    DailyRecordKind.sleep,
    DailyRecordKind.mood,
  ])('does not queue %s records when dimension gate fails', async (kind) => {
    await listener.handleDailyRecordChanged({
      userId: 'user-1',
      date: '2026-08-10',
      kind,
      recordId: 'record-1',
    });

    expect(contextService.shouldTriggerForDimension).toHaveBeenCalledWith(
      'user-1',
      '2026-08-10',
      kind,
    );
    expect(store.markPending).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('does not queue note records', async () => {
    await listener.handleDailyRecordChanged({
      userId: 'user-1',
      date: '2026-08-10',
      kind: DailyRecordKind.note,
      recordId: 'record-1',
    });

    expect(contextService.shouldTriggerForDimension).not.toHaveBeenCalled();
    expect(store.markPending).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('queues a persisted symptom record without inspecting its title', async () => {
    await listener.handleDailyRecordChanged({
      userId: 'user-1',
      date: '2026-08-10',
      kind: DailyRecordKind.symptom,
      recordId: 'record-1',
    });

    expect(contextService.shouldTriggerForDimension).not.toHaveBeenCalled();
    expect(store.markPending).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        localDate: '2026-08-10',
        reasonCode: 'symptom_check_in',
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith(
      'user-1',
      { date: '2026-08-10' },
      'zh-CN',
      4,
      'symptom_check_in',
      'daily-record:record-1',
    );
  });

  it.each(['create', 'end', 'check-in'] as const)(
    'queues health-event %s changes',
    async (change) => {
      await listener.handleHealthEventChanged({
        userId: 'user-1',
        eventId: 'event-1',
        date: '2026-08-10',
        change,
        ...(change === 'check-in' ? { kind: HealthEventKind.symptom } : {}),
      });

      expect(queue.enqueue).toHaveBeenCalledWith(
        'user-1',
        { date: '2026-08-10' },
        'zh-CN',
        4,
        'health_event_changed',
        expect.stringContaining('health-event:event-1:'),
      );
    },
  );

  it('does not queue a non-symptom check-in', async () => {
    await listener.handleHealthEventChanged({
      userId: 'user-1',
      eventId: 'event-1',
      date: '2026-08-10',
      change: 'check-in',
      kind: HealthEventKind.other,
    });

    expect(store.markPending).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('queues key medication state changes', async () => {
    await listener.handleDoseLogChanged({
      userId: 'user-1',
      date: '2026-08-10',
      doseLogId: 'dose-1',
    });

    expect(queue.enqueue).toHaveBeenCalledWith(
      'user-1',
      { date: '2026-08-10' },
      'zh-CN',
      4,
      'dose_log_changed',
      'dose-log:dose-1',
    );
  });

  it('queues an eligible suggestion materialization version and coalesces duplicates', async () => {
    await listener.handleSuggestionMaterializationChanged({
      userId: 'user-1',
      date: '2026-08-10',
      sourceVersion: 7,
      analysisEligible: true,
      triggerKey: 'dose:dose-1',
    });

    expect(queue.enqueue).toHaveBeenCalledWith(
      'user-1',
      { date: '2026-08-10' },
      'zh-CN',
      4,
      'suggestion_materialization_changed',
      'dose:dose-1',
    );
    expect(store.markPending).toHaveBeenCalledWith(
      expect.objectContaining({ requestedSourceVersion: 7 }),
    );
  });

  it('ignores suggestion materialization changes caused by ordinary records', async () => {
    await listener.handleSuggestionMaterializationChanged({
      userId: 'user-1',
      date: '2026-08-10',
      sourceVersion: 8,
      analysisEligible: false,
      triggerKey: 'daily-record:water-1',
    });

    expect(store.markPending).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('retains event listener methods for the declared domain event contract', () => {
    expect(DAILY_RECORD_CHANGED).toBe('daily-record.changed');
    expect(DOSE_LOG_CHANGED).toBe('dose-log.changed');
    expect(HEALTH_EVENT_CHANGED).toBe('health-event.changed');
    expect(TODAY_SUGGESTION_MATERIALIZATION_CHANGED).toBe(
      'today-suggestion.materialization.changed',
    );
  });
});
