import { buildToolDefinitions } from './tool-definitions.js';
import { ASSISTANT_TOOL_NAMES } from './tool-types.js';

describe('buildToolDefinitions', () => {
  it('returns empty array for empty tool names', () => {
    expect(buildToolDefinitions([])).toEqual([]);
  });

  it('returns a single definition for one tool', () => {
    const defs = buildToolDefinitions(['get_today_records']);

    expect(defs).toHaveLength(1);
    expect(defs[0]).toEqual({
      type: 'function',
      function: {
        name: 'get_today_records',
        description: expect.any(String),
        parameters: { type: 'object', properties: {} },
      },
    });
  });

  it('returns definitions for all registered tools', () => {
    const defs = buildToolDefinitions(ASSISTANT_TOOL_NAMES);

    expect(defs).toHaveLength(ASSISTANT_TOOL_NAMES.length);
    expect(defs.every((d) => d.function.name.length > 0)).toBe(true);
  });

  it('maps each name to the correct function name', () => {
    const subset = [
      'get_today_records',
      'get_user_profile',
      'search_cn_medicine_products',
    ] as const;
    const defs = buildToolDefinitions(subset);

    expect(defs.map((d) => d.function.name)).toEqual([
      'get_today_records',
      'get_user_profile',
      'search_cn_medicine_products',
    ]);
  });

  it('provides a non-empty description for each tool', () => {
    const defs = buildToolDefinitions(ASSISTANT_TOOL_NAMES);

    expect(defs.every((d) => d.function.description.length > 0)).toBe(true);
  });

  it('uses no-params schema for all tools', () => {
    const defs = buildToolDefinitions(['get_user_settings']);

    expect(defs[0]!.function.parameters).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('preserves order of input tool names', () => {
    const reversed = [...ASSISTANT_TOOL_NAMES].reverse();
    const defs = buildToolDefinitions(reversed);

    expect(defs.map((d) => d.function.name)).toEqual(reversed);
  });
});
