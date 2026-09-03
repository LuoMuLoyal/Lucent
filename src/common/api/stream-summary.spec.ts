import type { StreamSummaryEvent } from './stream-summary.js';

describe('stream-summary', () => {
  describe('StreamSummaryEvent interface', () => {
    it('creates a valid event object', () => {
      const event: StreamSummaryEvent = { summary: 'test summary' };
      expect(event.summary).toBe('test summary');
    });

    it('accepts empty string summary', () => {
      const event: StreamSummaryEvent = { summary: '' };
      expect(event.summary).toBe('');
    });

    it('accepts long summary text', () => {
      const longText = 'a'.repeat(1000);
      const event: StreamSummaryEvent = { summary: longText };
      expect(event.summary).toHaveLength(1000);
    });
  });
});
