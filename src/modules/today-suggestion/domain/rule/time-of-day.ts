/**
 * Which part of the day a rule is being evaluated in.
 *
 * Pure: the clock and the hour boundaries are inputs, not dependencies. The
 * collector adapter used to expose this as a static method, which made the
 * pipeline depend on the adapter just to read a clock.
 */

/** Hour (UTC) at which morning gives way to afternoon. */
const MORNING_START_HOUR = 5;

/** Hour (UTC) at which afternoon gives way to evening. */
const AFTERNOON_START_HOUR = 12;

/** Hour (UTC) at which evening gives way to night. */
const EVENING_START_HOUR = 17;

/** Hour (UTC) at which night gives way to morning. */
const NIGHT_START_HOUR = 22;

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

/** Classifies an instant into the rule context's `timeOfDay`. */
export function timeOfDay(date: Date = new Date()): TimeOfDay {
  const hour = date.getUTCHours();
  if (hour >= MORNING_START_HOUR && hour < AFTERNOON_START_HOUR) {
    return 'morning';
  }
  if (hour >= AFTERNOON_START_HOUR && hour < EVENING_START_HOUR) {
    return 'afternoon';
  }
  if (hour >= EVENING_START_HOUR && hour < NIGHT_START_HOUR) return 'evening';
  return 'night';
}
