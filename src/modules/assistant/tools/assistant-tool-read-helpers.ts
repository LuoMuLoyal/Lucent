export function describeReminderFrequency(
  reminders: Array<{
    daysOfWeek?: unknown;
    scheduledHour: number;
    scheduledMinute: number;
  }>,
): string | null {
  if (reminders.length === 0) return null;
  const first = reminders[0];
  if (first == null) return null;
  const daily =
    Array.isArray(first.daysOfWeek) && first.daysOfWeek.length > 0
      ? `${String(first.daysOfWeek.length)} days/week`
      : 'daily';
  const times = reminders
    .map(
      (item) =>
        `${item.scheduledHour.toString().padStart(2, '0')}:${item.scheduledMinute.toString().padStart(2, '0')}`,
    )
    .join(', ');
  return `${daily} @ ${times}`;
}

export function mapSleepQuality(value: string | null): number | null {
  switch (value) {
    case 'poor':
      return 1;
    case 'fair':
      return 2;
    case 'good':
      return 3;
    default:
      return null;
  }
}
