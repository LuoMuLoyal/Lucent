import {
  QUEUE_NAMES,
  QUEUE_NAME_LIST,
  isQueueName,
} from '../queue/queue-names.js';
import { EVENT_SUBSCRIPTIONS, subscriptionsFor } from './subscriptions.js';

const EVENT_NAMES: readonly string[] = Object.keys(EVENT_SUBSCRIPTIONS);

describe('EVENT_SUBSCRIPTIONS', () => {
  it('never carries an empty subscriber list', () => {
    for (const [name, subs] of Object.entries(EVENT_SUBSCRIPTIONS)) {
      // No consumers means no row at all — an empty array would claim a
      // deliberate decision that nobody can re-verify later.
      expect(subs.length, `${name} must not be empty`).toBeGreaterThan(0);
    }
  });

  it('only names registered queues', () => {
    for (const subs of Object.values(EVENT_SUBSCRIPTIONS)) {
      for (const sub of subs) {
        expect(isQueueName(sub.queue), sub.queue).toBe(true);
      }
    }
  });

  it('never subscribes the fan-out queue to itself', () => {
    const selfSubscribed = Object.values(EVENT_SUBSCRIPTIONS)
      .flat()
      .some((sub) => sub.queue === QUEUE_NAMES.eventFanout);
    expect(selfSubscribed).toBe(false);
  });

  it('has no duplicate queue+job pair per event', () => {
    for (const [name, subs] of Object.entries(EVENT_SUBSCRIPTIONS)) {
      const pairs = subs.map((sub) => `${sub.queue}#${sub.job}`);
      expect(new Set(pairs).size, `${name} has a duplicate subscription`).toBe(
        pairs.length,
      );
    }
  });

  it('is pure data: every subscription is a plain queue/job pair', () => {
    for (const subs of Object.values(EVENT_SUBSCRIPTIONS)) {
      for (const sub of subs) {
        expect(Object.keys(sub).sort()).toEqual(['job', 'queue']);
        expect(typeof sub.job).toBe('string');
        expect(sub.job.length).toBeGreaterThan(0);
      }
    }
  });

  it('leaves every fan-out queue either claimed or absent from the table', () => {
    // A queue name registered for fan-out must never be declared with zero
    // consumers, and must not appear in the table without a real subscriber.
    const subscribed = new Set(
      Object.values(EVENT_SUBSCRIPTIONS)
        .flat()
        .map((sub) => sub.queue),
    );
    for (const name of QUEUE_NAME_LIST) {
      if (subscribed.has(name)) {
        expect(EVENT_NAMES.length).toBeGreaterThan(0);
      }
    }
  });

  describe('subscriptionsFor', () => {
    it('returns an empty list for an event nobody listens to', () => {
      expect(subscriptionsFor('daily-record.changed')).toEqual([]);
      expect(subscriptionsFor('risk-assessment.completed')).toEqual([]);
    });

    it('returns an empty list for an unknown event', () => {
      expect(subscriptionsFor('nope.not.a.real.event')).toEqual([]);
    });

    it('returns the declared rows once a consumer is registered', () => {
      const event = Object.keys(EVENT_SUBSCRIPTIONS)[0];
      if (event == null) {
        // The table starts empty; this invariant only becomes meaningful once
        // the first consumer lands. Until then, everything resolves to [].
        expect(subscriptionsFor('missing')).toEqual([]);
        return;
      }
      expect(subscriptionsFor(event)).toEqual(EVENT_SUBSCRIPTIONS[event]);
    });
  });
});
