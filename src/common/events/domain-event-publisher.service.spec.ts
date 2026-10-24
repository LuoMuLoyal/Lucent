import type { EventEmitter2 } from '@nestjs/event-emitter';
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
  let eventEmitter: { emitAsync: vi.Mock };
  let publisher: DomainEventPublisher;

  beforeEach(() => {
    outbox = { append: vi.fn().mockResolvedValue('row-1') };
    eventEmitter = { emitAsync: vi.fn().mockResolvedValue(undefined) };
    publisher = new DomainEventPublisher(
      outbox as unknown as DomainEventOutboxService,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  it('persists and emits the same event', async () => {
    await publisher.publish(REMINDER_CHANGED, { userId: 'u1' });

    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(REMINDER_CHANGED, {
      userId: 'u1',
    });
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

  it('still emits in process when the outbox append fails', async () => {
    // A database hiccup must not also blind the consumers that were working
    // before this migration.
    outbox.append.mockRejectedValue(new Error('db down'));
    await publisher.publish(REMINDER_CHANGED, { userId: 'u1' });
    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
  });

  it('still persists when the in-process emit fails', async () => {
    eventEmitter.emitAsync.mockRejectedValue(new Error('listener boom'));
    await publisher.publish(REMINDER_CHANGED, { userId: 'u1' });
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('never throws, whichever half fails', async () => {
    outbox.append.mockRejectedValue(new Error('db down'));
    eventEmitter.emitAsync.mockRejectedValue(new Error('listener boom'));
    await expect(
      publisher.publish(REMINDER_CHANGED, { userId: 'u1' }),
    ).resolves.toBeUndefined();
  });

  it('persists before emitting, so a slow listener cannot delay the durable write', async () => {
    const order: string[] = [];
    outbox.append.mockImplementation(() => {
      order.push('append');
      return Promise.resolve('row-1');
    });
    eventEmitter.emitAsync.mockImplementation(() => {
      order.push('emit');
      return Promise.resolve(undefined);
    });

    await publisher.publish(REMINDER_CHANGED, { userId: 'u1' });
    expect(order).toEqual(['append', 'emit']);
  });
});
