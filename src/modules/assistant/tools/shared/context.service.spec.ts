import { AssistantContextService } from './context.service.js';

describe('AssistantContextService', () => {
  it('renders read envelopes and proposal summaries into a structured prompt block', () => {
    const service = new AssistantContextService();

    const block = service.buildToolContextBlock([
      {
        name: 'get_today_records',
        data: {
          query: { date: '2026-06-19' },
          result: { total: 1 },
          coverage: { status: 'complete', reason: null },
          timeRange: {
            timezone: 'UTC',
            startDate: '2026-06-19',
            endDate: '2026-06-19',
          },
          source: {
            tool: 'get_today_records',
            generatedAt: '2026-06-19T00:00:00.000Z',
            tables: ['daily_record'],
          },
          confidence: {
            level: 'high',
            reason: 'Resolved from the current UTC date.',
          },
          ambiguities: [],
        },
      },
      {
        name: 'propose_update_daily_record',
        data: {
          matchedRecord: {
            id: 'record-1',
          },
        },
        proposedActions: [
          {
            id: 'proposal-update-record-1',
            type: 'update_daily_record',
            status: 'proposed',
            confirmationRequired: true,
            title: 'Update this record',
            summary: 'Ready to update one water record from 2026-06-19.',
            reason: 'Matched one existing record.',
            previewFields: [],
            target: {
              kind: 'daily_record',
              label: '2026-06-19 water 300 ml',
              recordId: 'record-1',
              matchedBy: ['relative_today', 'kind', 'value'],
              snapshot: {
                id: 'record-1',
              },
            },
            constraints: ['Must be confirmed by you before any write happens.'],
            expiresAt: '2026-06-19T00:15:00.000Z',
            payloadVersion: 1,
            payload: {
              type: 'update_daily_record',
              recordId: 'record-1',
              draft: { note: 'after class' },
            },
          },
        ],
      },
    ]);

    expect(block).toContain('Server-approved user context tool results:');
    expect(block).toContain('- tool: get_today_records');
    expect(block).toContain('"coverage":{"status":"complete","reason":null}');
    expect(block).toContain('- tool: propose_update_daily_record');
    expect(block).toContain('"target":{"kind":"daily_record"');
    expect(block).toContain(
      '"constraints":["Must be confirmed by you before any write happens."]',
    );
    expect(block).toContain(
      'Respect coverage, confidence, ambiguities, and proposal-only boundaries exactly.',
    );
  });
});
