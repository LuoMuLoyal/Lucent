import { SuggestionFeedback } from '../types/suggestion.types.js';

/** Duration of "later" feedback suppression (milliseconds). */
export const FEEDBACK_LATER_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Duration of "not_applicable" feedback suppression (milliseconds). */
export const FEEDBACK_NOT_APPLICABLE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Duration of "suppress" feedback suppression (milliseconds). */
export const FEEDBACK_SUPPRESS_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Priority score boost for "accepted" feedback (percentage points). */
export const FEEDBACK_ACCEPTED_BOOST_PERCENT = 10;

/** Priority score reduction for "not_applicable" feedback (percentage points). */
export const FEEDBACK_NOT_APPLICABLE_REDUCTION_PERCENT = 30;

/** Feedback types that result in active suppression. */
export const SUPPRESSING_FEEDBACKS: SuggestionFeedback[] = [
  SuggestionFeedback.NOT_APPLICABLE,
  SuggestionFeedback.SUPPRESS,
];
