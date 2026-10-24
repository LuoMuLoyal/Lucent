import { EVENT_ORIGINS, eventOriginFor } from './event-origins.js';
import * as domainEvents from './domain-events.js';

/**
 * Every declared event name constant, read from the module's exports rather
 * than from a hand-kept list — a new constant is covered automatically.
 */
function declaredEventNames(): string[] {
  return Object.entries(domainEvents)
    .filter(
      ([key, value]) =>
        key.toUpperCase() === key &&
        typeof value === 'string' &&
        value.includes('.'),
    )
    .map(([, value]) => value as string);
}

describe('EVENT_ORIGINS', () => {
  it('declares a name that is actually a domain event constant', () => {
    // The drift this catches: a typo'd key (`daily-record.chanegd`) is never
    // looked up, so `eventOriginFor` silently falls back to `context:
    // 'unknown'` and the row loses its owning context — with no error anywhere.
    const declared = new Set(declaredEventNames());
    expect(declared.size).toBeGreaterThan(0);
    for (const name of Object.keys(EVENT_ORIGINS)) {
      expect(declared, `${name} is not a declared event name`).toContain(name);
    }
  });

  it('gives every origin a non-empty context and aggregate type', () => {
    for (const [name, origin] of Object.entries(EVENT_ORIGINS)) {
      expect(origin.context.length, `${name} context`).toBeGreaterThan(0);
      expect(
        origin.aggregateType.length,
        `${name} aggregateType`,
      ).toBeGreaterThan(0);
      expect(
        origin.aggregateIdField.length,
        `${name} aggregateIdField`,
      ).toBeGreaterThan(0);
    }
  });

  it('never uses the unknown fallback context for a declared event', () => {
    for (const name of Object.keys(EVENT_ORIGINS)) {
      expect(eventOriginFor(name).context).not.toBe('unknown');
    }
  });

  it('falls back to an attributable origin for an unregistered event', () => {
    // An unregistered name must still be persisted: the outbox is the record of
    // what happened, and dropping the row would be the bug this replaces.
    const origin = eventOriginFor('some.unregistered.event');
    expect(origin.context).toBe('unknown');
    expect(origin.aggregateIdField).toBe('userId');
  });
});
