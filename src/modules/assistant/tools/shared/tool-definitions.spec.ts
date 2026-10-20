import {
  buildToolDefinitions,
  CODE_TOOL_LIMIT_BUDGETS,
} from './tool-definitions.js';
import { ASSISTANT_TOOL_NAMES } from './tool-types.js';
import {
  MAX_MEAL_DIGEST_DAYS,
  MAX_MEAL_DIGEST_LIMIT,
} from './tool-constants.js';

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

  it('declares the model-chosen window for the meal digest tool', () => {
    const [def] = buildToolDefinitions(['get_meal_analysis_digest']);

    const parameters = def!.function.parameters as {
      type: string;
      properties: Record<string, { type: string; maximum: number }>;
      additionalProperties: boolean;
    };

    expect(parameters.type).toBe('object');
    expect(parameters.additionalProperties).toBe(false);
    expect(Object.keys(parameters.properties)).toEqual(['days', 'limit']);
    expect(parameters.properties['days']).toMatchObject({
      type: 'integer',
      maximum: MAX_MEAL_DIGEST_DAYS,
    });
    expect(parameters.properties['limit']).toMatchObject({
      type: 'integer',
      maximum: MAX_MEAL_DIGEST_LIMIT,
    });
  });

  it('keeps argument-driven and no-argument tools in one definition list', () => {
    const defs = buildToolDefinitions([
      'get_meal_analysis_digest',
      'get_today_records',
    ]);

    expect(defs[0]!.function.parameters).not.toEqual({
      type: 'object',
      properties: {},
    });
    expect(defs[1]!.function.parameters).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('advertises the limits handed in instead of the code baselines', () => {
    const budgets = {
      ...CODE_TOOL_LIMIT_BUDGETS,
      lightragMaxLimit: 3,
      semanticaMaxLimit: 42,
      semanticaReasonMaxLimit: 500,
    };

    const [knowledge, ontology, rules] = buildToolDefinitions(
      [
        'search_cn_medicine_knowledge',
        'reason_over_ontology',
        'reason_over_rules',
      ],
      budgets,
    );

    const limitOf = (def: typeof knowledge) =>
      (
        def!.function.parameters as {
          properties: Record<string, { maximum: number; description: string }>;
        }
      ).properties['limit'];

    // 上界同时进 schema 与描述：只改一处会让模型读到的上限和服务端夹紧的
    // 上限对不上（模型永远按较小的那个请求）。
    expect(limitOf(knowledge)).toMatchObject({ maximum: 3 });
    expect(limitOf(knowledge)?.description).toContain('(1-3)');
    expect(limitOf(ontology)).toMatchObject({ maximum: 42 });
    expect(limitOf(rules)).toMatchObject({ maximum: 500 });
  });

  it('keeps the code baselines when no budgets are passed', () => {
    const [def] = buildToolDefinitions(['search_cn_medicine_knowledge']);

    const parameters = def!.function.parameters as {
      properties: Record<string, { maximum: number }>;
    };
    expect(parameters.properties['limit']?.maximum).toBe(
      CODE_TOOL_LIMIT_BUDGETS.lightragMaxLimit,
    );
  });

  it('preserves order of input tool names', () => {
    const reversed = [...ASSISTANT_TOOL_NAMES].toReversed();
    const defs = buildToolDefinitions(reversed);

    expect(defs.map((d) => d.function.name)).toEqual(reversed);
  });
});
