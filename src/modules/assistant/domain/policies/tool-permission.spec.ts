/**
 * Pure unit tests for the tool-permission gate.
 */
import {
  CONTEXT_SOURCES,
  READ_TOOL_NAMES,
  TOOL_NAMES,
  TOOL_REQUIRED_SOURCES,
  selectEnabledSources,
  selectPermittedTools,
} from './tool-permission.js';

describe('tool permission gate', () => {
  it('permits every tool when all sources are on', () => {
    expect(selectPermittedTools(CONTEXT_SOURCES)).toHaveLength(TOOL_NAMES.length);
  });

  it('permits no data tool when no source is on, but keeps source-free tools', () => {
    const permitted = selectPermittedTools([]);
    expect(permitted).not.toContain('get_today_records');
    expect(permitted).toContain('search_cn_medicine_knowledge');
    expect(permitted).toContain('propose_create_daily_record');
  });

  it('requires every declared source, not just one', () => {
    expect(selectPermittedTools(['daily_records'])).toContain('get_today_records');
    expect(selectPermittedTools(['sleep_records'])).not.toContain('get_today_records');
  });

  it('declares sources for every tool', () => {
    for (const tool of TOOL_NAMES) {
      expect(TOOL_REQUIRED_SOURCES[tool]).toBeDefined();
    }
  });

  it('the read tools are a subset of all tools', () => {
    for (const tool of READ_TOOL_NAMES) {
      expect(TOOL_NAMES).toContain(tool);
    }
  });

  it('reports enabled sources in canonical order', () => {
    expect(selectEnabledSources((source) => source === 'sleep_records')).toEqual([
      'sleep_records',
    ]);
  });
});
