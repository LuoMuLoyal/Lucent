import {
  QUEUE_NAMES,
  QUEUE_NAME_LIST,
  isQueueName,
} from '../queue/queue-names.js';
import { EVENT_JOB_NAMES } from './jobs.js';
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

  it('only names jobs a declared consumer dispatches on', () => {
    // The drift this catches: a typo in `job` makes the fan-out enqueue a job
    // name no worker awaits. BullMQ accepts it silently and the event is never
    // handled, so nothing else in the system would report the mistake.
    for (const [name, subs] of Object.entries(EVENT_SUBSCRIPTIONS)) {
      for (const sub of subs) {
        expect(
          EVENT_JOB_NAMES,
          `${name} -> ${sub.queue}#${sub.job} is not a declared job name`,
        ).toContain(sub.job);
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

  it('declares every job name it can reach', () => {
    // `EVENT_JOB_NAMES` is the registry the guard above checks against; an
    // empty registry would make that guard vacuous.
    const used = new Set(
      Object.values(EVENT_SUBSCRIPTIONS)
        .flat()
        .map((sub) => sub.job),
    );
    for (const job of used) {
      expect(EVENT_JOB_NAMES).toContain(job);
    }
  });

  it('keeps every subscribed queue among the registered names', () => {
    const subscribed = new Set(
      Object.values(EVENT_SUBSCRIPTIONS)
        .flat()
        .map((sub) => sub.queue),
    );
    for (const name of subscribed) {
      expect(QUEUE_NAME_LIST).toContain(name);
    }
  });

  describe('subscriptionsFor', () => {
    it('returns an empty list for an event nobody listens to', () => {
      expect(subscriptionsFor('risk-assessment.completed')).toEqual([]);
    });

    it('returns an empty list for an unknown event', () => {
      expect(subscriptionsFor('nope.not.a.real.event')).toEqual([]);
    });

    it('returns the declared rows for a subscribed event', () => {
      for (const name of EVENT_NAMES) {
        expect(subscriptionsFor(name)).toEqual(EVENT_SUBSCRIPTIONS[name]);
      }
    });
  });
});
