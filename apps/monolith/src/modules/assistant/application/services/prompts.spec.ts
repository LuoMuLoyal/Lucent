import { describe, expect, it } from 'vitest';
import {
  buildAssistantSystemPrompt,
  assistantSystemPromptVariables,
} from './prompts.js';

const READ_TOOLS = ['get_today_records', 'get_sleep_summary_by_range'] as const;
const WRITE_TOOLS = ['propose_create_daily_record'] as const;
const KNOWLEDGE_TOOLS = [
  'search_cn_medicine_products',
  'search_cn_medicine_knowledge',
] as const;

/**
 * One prompt now serves every turn.
 *
 * There used to be four (read / write / knowledge / simple-chat), each asserted
 * separately, because the router picked one per turn. With one loop and one
 * tool set there is nothing to pick between, so the safety properties that were
 * duplicated across the four are asserted once, against the prompt that actually
 * ships.
 */
describe('assistant system prompt', () => {
  it('carries the identity and safety preamble', () => {
    const prompt = buildAssistantSystemPrompt(READ_TOOLS);
    expect(prompt).toContain('You are the Luminous health chat assistant.');
    expect(prompt).toContain(
      'Do not diagnose diseases or change medication plans.',
    );
    expect(prompt).toContain(
      'Only use facts recorded by the user or returned by allowed tools.',
    );
  });

  it('names the allowed tools and their scope', () => {
    const prompt = buildAssistantSystemPrompt(READ_TOOLS);
    expect(prompt).toContain('Allowed tools in this run:');
    expect(prompt).toContain('get_today_records');
    // The scope line exists because a turn's candidate set is not a statement
    // about the product: a 2026-10-07 incident had the model tell users a
    // capability did not exist because that turn did not include its tool.
    expect(prompt).toContain("this run's permission-filtered set");
    expect(prompt).toContain(
      'Never tell the user that a capability does not exist',
    );
  });

  it('says "none" when the candidate set is empty', () => {
    const prompt = buildAssistantSystemPrompt([]);
    expect(prompt).toContain('Allowed tools in this run: none.');
    expect(prompt).toContain(
      'No server-approved user data tools are available',
    );
  });

  it('emphasizes the result envelope and forbids smoothing over gaps', () => {
    const prompt = buildAssistantSystemPrompt(READ_TOOLS);
    expect(prompt).toContain('coverage');
    expect(prompt).toContain('ambiguities');
    expect(prompt).toContain('When coverage is partial or empty');
    expect(prompt).toContain(
      'A missing edge means the source data has no such assertion',
    );
  });

  it('states proposal-only semantics for writes', () => {
    const prompt = buildAssistantSystemPrompt(WRITE_TOOLS);
    expect(prompt).toContain('Proposal tools do not perform writes');
    expect(prompt).toContain('confirmation-required drafts');
    expect(prompt).toContain('refusal to guess the write target');
  });

  it('keeps the three evidence sources separate', () => {
    const prompt = buildAssistantSystemPrompt(KNOWLEDGE_TOOLS);
    expect(prompt).toContain('Do not attribute one to another');
    expect(prompt).toContain('Trust order:');
    expect(prompt).toContain('package-insert prose (highest)');
    expect(prompt).toContain('open QA corpus (low-trust reference)');
    expect(prompt).toContain('If retrieval misses, say evidence was not found');
  });

  it('frames the open QA corpus as low-trust reference', () => {
    const prompt = buildAssistantSystemPrompt(KNOWLEDGE_TOOLS);
    expect(prompt).toContain('open QA corpus');
    expect(prompt).toContain('lower-trust educational reference');
  });

  it('requires provenance ids from ontology reasoning without overstating them', () => {
    const prompt = buildAssistantSystemPrompt(['reason_over_ontology']);
    expect(prompt).toContain('[prov: <id>]');
    expect(prompt).toContain('never cite an id the result does not contain');
    expect(prompt).toContain('verifiability "uncited"');
  });

  it('tells the model a turn may span several unrelated tools', () => {
    // The single loop is what makes this possible; before, a turn was confined
    // to one sub-graph and could not change domain mid-way.
    const prompt = buildAssistantSystemPrompt(READ_TOOLS);
    expect(prompt).toContain('A single turn may need several unrelated tools');
  });

  it('never repeats tool parameter rules that the tool definitions carry', () => {
    // DSH tool-design rule: each fact stated once. Parameter ranges and
    // defaults belong on the parameter, not in the prompt.
    const prompt = buildAssistantSystemPrompt(KNOWLEDGE_TOOLS);
    expect(prompt).not.toContain('maximum:');
    expect(prompt).not.toContain('Defaults to');
  });

  describe('variables', () => {
    it('reports tool availability as a string the override renderer can fill', () => {
      const withTools = assistantSystemPromptVariables(READ_TOOLS);
      expect(withTools.tools).toBe(READ_TOOLS.join(', '));
      expect(withTools.toolAvailability).toContain('If a tool is available');

      const without = assistantSystemPromptVariables([]);
      expect(without.tools).toBe('none');
      expect(without.toolAvailability).toContain(
        'No server-approved user data tools are available',
      );
    });
  });
});
