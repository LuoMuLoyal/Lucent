import { DomainEventPublisher } from './domain-event-publisher.service.js';
import type { DomainEventOutboxService } from './domain-events-outbox.service.js';
import {
  DAILY_RECORD_CHANGED,
  HEALTH_EVENT_CHANGED,
  REMINDER_CHANGED,
  RISK_ASSESSMENT_COMPLETED,
} from './domain-events.js';

describe('DomainEventPublisher', () => {
  let outbox: { append: vi.Mock };
  let publisher: DomainEventPublisher;

  beforeEach(() => {
    outbox = { append: vi.fn().mockResolvedValue('row-1') };
    publisher = new DomainEventPublisher(
      outbox as unknown as DomainEventOutboxService,
    );
  });

  it('persists the event', async () => {
    await publisher.publish(REMINDER_CHANGED, { userId: 'u1' });
    expect(outbox.append).toHaveBeenCalledTimes(1);
    const appended = outbox.append.mock.calls[0]?.[0] as {
      eventName: string;
      payload: Record<string, unknown>;
    };
    expect(appended.eventName).toBe(REMINDER_CHANGED);
    expect(appended.payload).toEqual({ userId: 'u1' });
  });

  it('does not deliver in process (delivery is the poller\u2019s job)', async () => {
    // ADR-0025 step 7: the publisher only appends. If it also emitted, every
    // event would be delivered twice once the fan-out is live.
    await publisher.publish(REMINDER_CHANGED, { userId: 'u1' });
    expect(outbox.append).toHaveBeenCalledTimes(1);
    // The publisher has no emitter dependency at all now; this asserts the
    // shape rather than a call, so it fails loudly if one is reintroduced.
    expect(Object.keys(publisher)).not.toContain('eventEmitter');
  });

  it('derives the aggregate from the declared origin, not the caller', async () => {
    await publisher.publish(DAILY_RECORD_CHANGED, {
      userId: 'u1',
      date: '2026-10-24',
      recordId: 'rec-9',
    });

    const appended = outbox.append.mock.calls[0]?.[0] as {
      context: string;
      aggregateType: string;
      aggregateId: string;
    };
    expect(appended.context).toBe('daily-records');
    expect(appended.aggregateType).toBe('daily-record');
    expect(appended.aggregateId).toBe('rec-9');
  });

  it('falls back to the user id when the payload has no aggregate id', async () => {
    await publisher.publish(REMINDER_CHANGED, { userId: 'u1' });
    const appended = outbox.append.mock.calls[0]?.[0] as {
      aggregateId: string;
    };
    expect(appended.aggregateId).toBe('u1');
  });

  it('prefers the specific aggregate id when both are present', async () => {
    await publisher.publish(HEALTH_EVENT_CHANGED, {
      userId: 'u1',
      eventId: 'evt-7',
      date: '2026-10-24',
      change: 'create',
    });
    const appended = outbox.append.mock.calls[0]?.[0] as {
      aggregateType: string;
      aggregateId: string;
    };
    expect(appended.aggregateType).toBe('health-event');
    expect(appended.aggregateId).toBe('evt-7');
  });

  it('passes an explicit dedupe key through', async () => {
    await publisher.publish(
      RISK_ASSESSMENT_COMPLETED,
      { userId: 'u1', assessmentId: 'a-1' },
      'risk-assessment.completed:a-1',
    );
    const appended = outbox.append.mock.calls[0]?.[0] as {
      dedupeKey?: string;
    };
    expect(appended.dedupeKey).toBe('risk-assessment.completed:a-1');
  });

  it('omits the dedupe key when the caller does not name one', async () => {
    await publisher.publish(REMINDER_CHANGED, { userId: 'u1' });
    const appended = outbox.append.mock.calls[0]?.[0] as {
      dedupeKey?: string;
    };
    expect(appended.dedupeKey).toBe(undefined);
  });

  it('never throws when the append fails', async () => {
    // Publishing is best-effort: a database hiccup must not fail the business
    // write that triggered the event.
    outbox.append.mockRejectedValue(new Error('db down'));
    await expect(
      publisher.publish(REMINDER_CHANGED, { userId: 'u1' }),
    ).resolves.toBeUndefined();
  });
});
