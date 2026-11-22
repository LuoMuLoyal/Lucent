import { describe, expect, it } from 'vitest';
import {
  AMAP_MCP_SERVER_NAME,
  describeExternalTools,
  externalRemoteName,
  externalToolName,
  isExternalToolName,
} from './external-tools.js';

/**
 * External tools are a different noun from built-in tools, and this file pins
 * the two properties that make that difference safe:
 *
 * 1. the prefix is a pure function (the model sees it on every turn), and
 * 2. a remote name can never take the place of a built-in one.
 */
describe('external tool naming', () => {
  it('prefixes with the server name and round-trips back', () => {
    const name = externalToolName(AMAP_MCP_SERVER_NAME, 'maps_weather');
    expect(name).toBe('amap__maps_weather');
    expect(externalRemoteName(name)).toBe('maps_weather');
    expect(isExternalToolName(name)).toBe(true);
  });

  it('does not treat a built-in tool name as external', () => {
    // Built-in names carry no separator, which is what keeps them from being
    // dispatched to the remote client.
    expect(isExternalToolName('get_today_records')).toBe(false);
    expect(isExternalToolName('reason_ontology')).toBe(false);
  });

  it('rejects a separator at the very start or end', () => {
    // `__x` has no server prefix; `x__` has no remote name. Both are malformed
    // rather than external.
    expect(isExternalToolName('__x')).toBe(false);
    expect(isExternalToolName('x__')).toBe(false);
  });

  it('returns the input unchanged when there is no prefix', () => {
    // Defensive: callers only reach here after `isExternalToolName`, so a
    // mismatch should stay visible in the remote call rather than crash.
    expect(externalRemoteName('maps_weather')).toBe('maps_weather');
  });
});

describe('describeExternalTools', () => {
  const tools = [
    {
      name: 'maps_weather',
      description: 'Weather for a city',
      inputSchema: { type: 'object' },
    },
    {
      name: 'maps_geo',
      description: 'Address to coordinates',
      inputSchema: { type: 'object' },
    },
  ];

  it('prefixes every advertised tool', () => {
    const definitions = describeExternalTools(
      AMAP_MCP_SERVER_NAME,
      tools,
      new Set(),
    );

    expect(definitions.map((definition) => definition.name)).toEqual([
      'amap__maps_weather',
      'amap__maps_geo',
    ]);
    expect(definitions[0]?.remoteName).toBe('maps_weather');
    expect(definitions[0]?.serverName).toBe(AMAP_MCP_SERVER_NAME);
  });

  it('drops a tool whose prefixed name collides with a taken name', () => {
    // Dropping (not renaming) is the point: a silent rename would advertise a
    // name the model cannot call back.
    const definitions = describeExternalTools(
      AMAP_MCP_SERVER_NAME,
      tools,
      new Set(['amap__maps_weather']),
    );

    expect(definitions.map((definition) => definition.name)).toEqual([
      'amap__maps_geo',
    ]);
  });

  it('keeps the remote schema verbatim', () => {
    const definitions = describeExternalTools(
      AMAP_MCP_SERVER_NAME,
      [tools[0]!],
      new Set(),
    );

    // One source of truth for arguments: the remote server's own schema.
    expect(definitions[0]?.inputSchema).toEqual({ type: 'object' });
  });

  it('yields an empty list when the server advertises nothing', () => {
    expect(describeExternalTools(AMAP_MCP_SERVER_NAME, [], new Set())).toEqual(
      [],
    );
  });
});
