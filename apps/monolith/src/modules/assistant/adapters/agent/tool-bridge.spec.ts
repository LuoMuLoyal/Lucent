import { describe, expect, it, vi } from 'vitest';
import { CODE_TOOL_LIMIT_BUDGETS } from '../acl/tools/shared/tool-definitions.js';
import type { AssistantToolExecutionResult } from '../../application/ports/assistant.js';
import type { ToolName } from '../../domain/policies/tool-permission.js';
import { buildDeepAgentTools } from './tool-bridge.js';

/**
 * The bridge exists so deepagents can call the **existing** executor.
 *
 * These tests assert exactly that: the tool set, the names, and the fact that
 * the model's arguments reach `executeMany` unchanged. Re-implementing execution
 * here would be a second executor, and a second executor is how the proposal
 * envelopes and the timeout contract quietly diverge.
 */
describe('buildDeepAgentTools', () => {
  const budgets = CODE_TOOL_LIMIT_BUDGETS;

  it('exposes one tool per allowed name, keeping the assistant’s names', () => {
    const names: ToolName[] = [
      'get_today_records',
      'search_cn_knowledge',
    ];
    const tools = buildDeepAgentTools({
      toolNames: names,
      budgets,
      execute: vi.fn().mockResolvedValue([]),
    });

    expect(tools.map((tool) => tool.name)).toEqual(names);
  });

  it('forwards the model’s arguments to the production executor', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue([
        { name: 'get_meal_digest', data: { meals: [] } },
      ]);

    const [digest] = buildDeepAgentTools({
      toolNames: ['get_meal_digest'],
      budgets,
      execute,
    });

    await digest?.invoke({ days: 3, limit: 5 });

    // Arguments are passed through as `args`, which is where the existing tools
    // read them from — never parsed out of the user message.
    expect(execute).toHaveBeenCalledWith([
      { name: 'get_meal_digest', args: { days: 3, limit: 5 } },
    ]);
  });

  it('sends an empty argument object for tools that take none', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue([{ name: 'get_today_records', data: {} }]);

    const [recordTool] = buildDeepAgentTools({
      toolNames: ['get_today_records'],
      budgets,
      execute,
    });

    await recordTool?.invoke({});

    expect(execute).toHaveBeenCalledWith([
      { name: 'get_today_records', args: {} },
    ]);
  });

  it('renders a timeout envelope as text the model can act on', async () => {
    // The tool is not re-run and does not throw: the model is told the budget
    // ran out so it reports the gap instead of inventing a result.
    const execute = vi.fn().mockResolvedValue([
      {
        name: 'reason_ontology',
        data: { timeout: true },
        timeout: true,
      } satisfies AssistantToolExecutionResult,
    ]);

    const [ontology] = buildDeepAgentTools({
      toolNames: ['reason_ontology'],
      budgets,
      execute,
    });

    const rendered = await ontology?.invoke({ question: 'does A inhibit B' });

    expect(String(rendered)).toContain('"timeout":true');
    expect(String(rendered)).toContain('Report the gap rather than guessing');
  });

  it('renders an ordinary result as its data payload', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue([{ name: 'get_today_records', data: { water: 800 } }]);

    const [recordTool] = buildDeepAgentTools({
      toolNames: ['get_today_records'],
      budgets,
      execute,
    });

    const rendered = await recordTool?.invoke({});

    expect(JSON.parse(String(rendered))).toEqual({ water: 800 });
  });

  it('surfaces a missing executor result instead of reporting success', async () => {
    // The executor contracts one result per call. A silent "ok" would hide the
    // broken contract from the model and from the caller.
    const execute = vi.fn().mockResolvedValue([]);

    const [recordTool] = buildDeepAgentTools({
      toolNames: ['get_today_records'],
      budgets,
      execute,
    });

    const rendered = JSON.parse(String(await recordTool?.invoke({})));

    expect(rendered.unavailable).toBe(true);
  });
});
