import { AIMessage } from '@langchain/core/messages';
import {
  buildAssistantRuntimeGraph,
  selectAllowedToolsForContextSources,
} from './graph';
import { selectRelevantToolsForMessage } from './router';

describe('AssistantFoundationGraph', () => {
  it('selects relevant tools from the user message', () => {
    expect(
      selectRelevantToolsForMessage('最近睡眠怎么样', [
        'get_user_profile',
        'get_sleep_summary_by_range',
        'get_current_medicines',
      ]),
    ).toEqual(['get_sleep_summary_by_range']);

    expect(
      selectRelevantToolsForMessage(
        '查一下国药准字H10900089这个药的成分和厂家',
        [
          'search_cn_medicine_products',
          'get_cn_medicine_detail',
          'search_medicine_leaflets',
        ],
      ),
    ).toEqual([
      'search_cn_medicine_products',
      'get_cn_medicine_detail',
      'search_medicine_leaflets',
    ]);

    expect(
      selectRelevantToolsForMessage(
        '这个国药准字H10900089的禁忌和不良反应是什么',
        [
          'search_cn_medicine_products',
          'get_cn_medicine_detail',
          'search_medicine_leaflets',
          'resolve_drugbank_entity',
          'get_drugbank_detail',
          'search_drugbank_passages',
          'search_medical_qa_corpus',
        ],
      ),
    ).toEqual([
      'search_cn_medicine_products',
      'get_cn_medicine_detail',
      'search_medicine_leaflets',
    ]);
  });

  it('selects point summary tools for dated history questions', () => {
    expect(
      selectRelevantToolsForMessage('看看 2026-06-17 的 today summary', [
        'get_recent_today_summaries',
        'get_today_summary_by_date',
      ]),
    ).toEqual(['get_today_summary_by_date']);

    expect(
      selectRelevantToolsForMessage('帮我看上次月报总结', [
        'get_recent_report_summaries',
        'get_report_summary_by_range',
      ]),
    ).toEqual(['get_report_summary_by_range']);

    expect(
      selectRelevantToolsForMessage('给我看看历史 Today AI 总结', [
        'get_recent_today_summaries',
        'get_today_summary_by_date',
      ]),
    ).toEqual(['get_recent_today_summaries']);

    expect(
      selectRelevantToolsForMessage('给我看看历史 Report AI 总结', [
        'get_recent_report_summaries',
        'get_report_summary_by_range',
      ]),
    ).toEqual(['get_recent_report_summaries']);
  });

  it('selects write-intent tools from save-style messages', () => {
    expect(
      selectRelevantToolsForMessage('帮我记一下今天喝了 300ml 水', [
        'get_today_records',
        'propose_create_daily_record',
        'propose_update_user_settings',
      ]),
    ).toEqual(['get_today_records', 'propose_create_daily_record']);

    expect(
      selectRelevantToolsForMessage('把今天那条 300ml 饮水记录备注改一下', [
        'get_today_records',
        'propose_create_daily_record',
        'propose_update_daily_record',
        'propose_update_user_settings',
      ]),
    ).toEqual(['propose_update_daily_record']);

    expect(
      selectRelevantToolsForMessage('把 assistant memory 关掉', [
        'propose_update_daily_record',
        'propose_update_user_settings',
      ]),
    ).toEqual(['propose_update_user_settings']);
  });

  it('derives allowed tools from enabled context sources', () => {
    expect(
      selectAllowedToolsForContextSources(['health_profile', 'sleep_records']),
    ).toEqual([
      'get_today_summary_by_date',
      'get_report_summary_by_range',
      'get_recent_today_summaries',
      'get_recent_report_summaries',
      'get_user_profile',
      'get_user_settings',
      'get_sleep_summary_by_range',
      'search_cn_medicine_products',
      'get_cn_medicine_detail',
      'search_medicine_leaflets',
      'search_medical_qa_corpus',
      'resolve_drugbank_entity',
      'get_drugbank_detail',
      'search_drugbank_passages',
      'propose_create_daily_record',
      'propose_update_user_settings',
    ]);
  });

  it('runs the tool-loop graph and returns final content when LLM produces text', async () => {
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '你好，我是健康助手。' }));
    const mockModel = {
      bindTools: vi.fn().mockReturnValue({ invoke: mockInvoke }),
    };

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '你好',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile', 'sleep_records'],
    });

    expect(result.finalContent).toBe('你好，我是健康助手。');
    expect(result.toolResults).toEqual([]);
    expect(result.stopReason).toBe('answered');
  });

  it('executes tools when the LLM requests them and loops back', async () => {
    let callCount = 0;
    const mockInvoke = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(
          new AIMessage({
            content: '',
            tool_calls: [{ name: 'get_user_profile', id: 'call_0', args: {} }],
          }),
        );
      }
      return Promise.resolve(new AIMessage({ content: '根据您的健康档案...' }));
    });
    const mockModel = {
      bindTools: vi.fn().mockReturnValue({ invoke: mockInvoke }),
    };

    const executeTools = vi.fn().mockResolvedValue([
      {
        name: 'get_user_profile',
        data: { summary: { activeAllergyCount: 1 } },
      },
    ]);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools,
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '我的过敏情况',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile'],
    });

    expect(executeTools).toHaveBeenCalledTimes(1);
    expect(executeTools).toHaveBeenCalledWith(['get_user_profile']);
    expect(result.toolResults).toHaveLength(1);
    expect(result.finalContent).toBe('根据您的健康档案...');
    expect(result.loopCount).toBe(1);
    expect(result.stopReason).toBe('answered');
  });

  it('stops at the tool-loop cap when LLM keeps requesting tools', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({
        content: '',
        tool_calls: [{ name: 'get_user_profile', id: 'call_0', args: {} }],
      }),
    );
    const mockModel = {
      bindTools: vi.fn().mockReturnValue({ invoke: mockInvoke }),
    };

    const executeTools = vi.fn().mockResolvedValue([
      {
        name: 'get_user_profile',
        data: { summary: {} },
      },
    ]);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools,
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '持续查询',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile'],
    });

    // MAX_TOOL_LOOPS = 3, so tools are called at most 3 times
    expect(executeTools).toHaveBeenCalledTimes(3);
    expect(result.loopCount).toBe(3);
  });
});
