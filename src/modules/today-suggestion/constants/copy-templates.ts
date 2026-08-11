/**
 * Copy template definitions for AI-generated suggestion copy.
 *
 * These templates define the parameters required for each suggestion type.
 * The actual copy generation is handled by SuggestionCopyService.
 */

export interface CopyTemplate {
  /** Human-readable description of this template */
  description: string;
  /** Required parameter keys */
  requiredParams: string[];
  /** Optional parameter keys */
  optionalParams?: string[];
  /** Suggested action label keys for this template */
  actionKeys?: string[];
}

/**
 * Template registry for all suggestion copy types.
 */
export const COPY_TEMPLATES: Record<string, CopyTemplate> = {
  // Coverage templates
  'coverage.profile.incomplete': {
    description:
      'Profile completeness coverage card - user profile missing fields',
    requiredParams: ['missingFields', 'fieldCount'],
    actionKeys: ['complete_profile'],
  },
  'coverage.record.empty_today': {
    description: 'No records today - encourage user to start recording',
    requiredParams: ['todayCount'],
    actionKeys: ['go_record'],
  },

  // Compliance templates
  'missed.dose.pending': {
    description: 'Overdue medication reminder - dose not confirmed',
    requiredParams: [
      'medicineName',
      'timeLabel',
      'hoursOverdue',
      'minsRemainder',
      'overdueMinutes',
    ],
    optionalParams: ['scheduledHour', 'scheduledMinute'],
    actionKeys: ['confirm_dose', 'skip_dose'],
  },

  // Behavior advice templates
  'water.behind.target': {
    description: 'Water intake below target - afternoon reminder',
    requiredParams: [
      'observedMl',
      'targetMl',
      'completionRate',
      'consecutiveDays',
    ],
    actionKeys: ['record_water'],
  },
  'sleep.shortfall': {
    description: 'Sleep duration insufficient - below 6 hours',
    requiredParams: ['hours', 'mins', 'durationMinutes', 'consecutiveDays'],
    actionKeys: ['record_sleep'],
  },
  'mood.sleep.correlation': {
    description: 'Low mood correlated with poor sleep',
    requiredParams: [
      'avgMood',
      'latestMoodScore',
      'latestMoodLabel',
      'hours',
      'mins',
      'durationMinutes',
      'moodDays',
      'overlappingDays',
    ],
    actionKeys: ['record_mood'],
  },
  'caffeine.sleep.correlation': {
    description: 'Caffeine intake correlated with declining sleep',
    requiredParams: [
      'caffeineDays',
      'totalCaffeine',
      'decline',
      'hours',
      'mins',
      'latestDuration',
      'overlappingDays',
    ],
    actionKeys: ['record_meal'],
  },

  // Trend templates
  'symptom.deteriorating.trend': {
    description: 'Symptom showing deteriorating trend over multiple days',
    requiredParams: [
      'symptomTitle',
      'daysCount',
      'latestValue',
      'totalRecords',
    ],
    optionalParams: ['confidence'],
    actionKeys: ['record_symptom', 'consult_doctor'],
  },
};

/**
 * Action label templates (keys for generating action button text).
 * These are separate from the main copy to allow consistent action labeling.
 */
export const ACTION_LABEL_TEMPLATES: Record<
  string,
  { default: string; short?: string }
> = {
  complete_profile: { default: 'complete_profile', short: 'go' },
  go_record: { default: 'go_record', short: 'go' },
  confirm_dose: { default: 'confirm_dose', short: 'confirm' },
  skip_dose: { default: 'skip_dose', short: 'skip' },
  record_water: { default: 'record_water', short: 'record' },
  record_sleep: { default: 'record_sleep', short: 'record' },
  record_mood: { default: 'record_mood', short: 'record' },
  record_meal: { default: 'record_meal', short: 'record' },
  record_symptom: { default: 'record_symptom', short: 'record' },
  consult_doctor: { default: 'consult_doctor', short: 'consult' },
};

/**
 * Validates that a template exists and required params are provided.
 */
export function validateCopyTemplate(
  templateKey: string,
  params: Record<string, unknown>,
): { valid: boolean; missing?: string[] | undefined } {
  const template = COPY_TEMPLATES[templateKey];
  if (!template) {
    return { valid: false, missing: ['template not found'] };
  }

  const missing = template.requiredParams.filter((key) => !(key in params));
  return {
    valid: missing.length === 0,
    missing: missing.length > 0 ? missing : undefined,
  };
}
