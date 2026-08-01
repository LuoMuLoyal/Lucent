import { describe, expect, it } from 'vitest';
import {
  buildAssistantSystemPrompt,
  buildKnowledgeSystemPrompt,
  buildReadSystemPrompt,
  buildSimpleChatSystemPrompt,
  buildWriteSystemPrompt,
} from './system.prompt';

const READ_TOOLS = ['get_today_records', 'get_sleep_summary_by_range'] as const;

describe('assistant system prompts', () => {
  it('shares identity and safety lines across all prompts', () => {
    for (const prompt of [
      buildAssistantSystemPrompt(READ_TOOLS),
      buildReadSystemPrompt(READ_TOOLS),
      buildWriteSystemPrompt(READ_TOOLS),
      buildKnowledgeSystemPrompt(READ_TOOLS),
      buildSimpleChatSystemPrompt(),
    ]) {
      expect(prompt).toContain('You are the Luminous health chat assistant.');
      expect(prompt).toContain(
        'Do not diagnose diseases or change medication plans.',
      );
    }
  });

  it('read prompt emphasizes the result envelope', () => {
    const prompt = buildReadSystemPrompt(READ_TOOLS);
    expect(prompt).toContain('coverage');
    expect(prompt).toContain('ambiguities');
    expect(prompt).toContain('When coverage is partial or empty');
    expect(prompt).not.toContain('Proposal tools do not perform writes');
  });

  it('write prompt emphasizes proposal-only semantics', () => {
    const prompt = buildWriteSystemPrompt(['propose_create_daily_record']);
    expect(prompt).toContain('Proposal tools do not perform writes');
    expect(prompt).toContain('confirmation-required');
    expect(prompt).toContain('refusal to guess the write target');
    expect(prompt).not.toContain('coverage is partial or empty');
  });

  it('knowledge prompt emphasizes evidence-source separation', () => {
    const prompt = buildKnowledgeSystemPrompt([
      'search_cn_medicine_products',
      'search_medicine_leaflets',
    ]);
    expect(prompt).toContain('Do not attribute one to another');
    expect(prompt).toContain('Prefer Chinese leaflet evidence');
    expect(prompt).toContain('Prefer DrugBank scientific evidence');
    expect(prompt).toContain('If retrieval misses');
  });

  it('simple-chat prompt forbids claiming data access', () => {
    const prompt = buildSimpleChatSystemPrompt();
    expect(prompt).toContain('No server-approved data tools are available');
    expect(prompt).toContain('Do not claim you inspected records');
    expect(prompt).not.toContain('Allowed tools in this run');
  });
});
