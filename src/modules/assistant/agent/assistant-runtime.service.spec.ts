import { AIMessageChunk } from '@langchain/core/messages';
import type { LlmRuntimeService } from '../../llm-runtime/llm-runtime.service';
import { AssistantRuntimeService } from './assistant-runtime.service';
import { buildAssistantSystemPrompt } from '../prompts/assistant-system.prompt';

function buildLeafletService(hasChunks = false) {
  return {
    hasIndexedChunks: jest.fn().mockResolvedValue(hasChunks),
    getMedicineLeafletContext: jest.fn(),
  };
}

describe('AssistantRuntimeService', () => {
  it('describes the phase-1 backend foundation', async () => {
    const llmRuntimeService = {
      hasRoleConfig: jest
        .fn()
        .mockImplementation((role: string) => role === 'chat'),
    } as unknown as LlmRuntimeService;

    const leafletService = buildLeafletService(false);
    const service = new AssistantRuntimeService(
      llmRuntimeService,
      leafletService as never,
    );

    expect(service.hasChatModel()).toBe(true);
    expect(await service.describeFoundation()).toEqual({
      phase: 'foundation',
      chatModelConfigured: true,
      interactiveChatReady: true,
      langGraphReady: true,
      ragEnabled: false,
      graphNodeNames: ['prepare_context', 'respond'],
      toolNames: [
        'get_today_records',
        'get_records_by_date',
        'get_records_by_range',
        'get_today_summary_by_date',
        'get_report_summary_by_range',
        'get_recent_today_summaries',
        'get_recent_report_summaries',
        'get_user_profile',
        'get_user_settings',
        'get_current_medicines',
        'get_sleep_summary_by_range',
        'get_medicine_leaflet_context',
        'propose_create_daily_record',
        'propose_update_daily_record',
        'propose_delete_daily_record',
        'propose_update_user_settings',
      ],
      implementedToolNames: [
        'get_today_records',
        'get_records_by_date',
        'get_records_by_range',
        'get_today_summary_by_date',
        'get_report_summary_by_range',
        'get_recent_today_summaries',
        'get_recent_report_summaries',
        'get_user_profile',
        'get_user_settings',
        'get_current_medicines',
        'get_sleep_summary_by_range',
        'get_medicine_leaflet_context',
        'propose_create_daily_record',
        'propose_update_daily_record',
        'propose_delete_daily_record',
        'propose_update_user_settings',
      ],
      contextSources: [
        'health_profile',
        'daily_records',
        'sleep_records',
        'current_medicines',
      ],
    });
  });

  it('streams assistant chunks into one final message', async () => {
    async function* buildStream() {
      await Promise.resolve();
      yield new AIMessageChunk({ content: 'Hello' });
      yield new AIMessageChunk({ content: ' world' });
    }

    const llmRuntimeService = {
      hasRoleConfig: jest.fn().mockReturnValue(true),
      createChatModel: jest.fn().mockReturnValue({
        stream: jest.fn().mockResolvedValue(buildStream()),
      }),
    } as unknown as LlmRuntimeService;

    const leafletService = buildLeafletService(false);
    const service = new AssistantRuntimeService(
      llmRuntimeService,
      leafletService as never,
    );
    const onChunk = jest.fn();

    const result = await service.generateStream(
      {
        locale: 'en',
        messages: [{ role: 'user', content: 'Hi' }],
        allowedTools: ['get_user_profile'],
        toolResults: [
          {
            name: 'get_user_profile',
            data: { summary: { activeAllergyCount: 1 } },
          },
        ],
      },
      onChunk,
    );

    expect(result).toEqual({
      content: 'Hello world',
      usedToolNames: ['get_user_profile'],
    });
    expect(onChunk).toHaveBeenNthCalledWith(1, { content: 'Hello' });
    expect(onChunk).toHaveBeenNthCalledWith(2, { content: ' world' });
  });

  it('documents the tightened read/proposal rules in the system prompt', () => {
    const prompt = buildAssistantSystemPrompt([
      'get_recent_today_summaries',
      'propose_update_daily_record',
    ]);

    expect(prompt).toContain(
      'coverage, timeRange, source, confidence, and ambiguities',
    );
    expect(prompt).toContain(
      'Historical AI summaries mean persisted Today/Report summaries',
    );
    expect(prompt).toContain('Proposal tools do not perform writes');
    expect(prompt).toContain('refusal to guess the write target');
  });
});
