/**
 * Event emitted during an AI summary stream, carrying the latest partial
 * summary text.
 */
export interface StreamSummaryEvent {
  summary: string;
}
