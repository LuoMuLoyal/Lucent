import { describe, expect, it } from 'vitest';
import {
  buildAssistantSystemPrompt,
  buildKnowledgeSystemPrompt,
  buildReadSystemPrompt,
  buildSimpleChatSystemPrompt,
  buildWriteSystemPrompt,
} from './system.prompt.js';

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
    expect(prompt).toContain('open corpus of low-trust');
    expect(prompt).toContain('Trust layering for knowledge answers');
  });

  it('assistant prompt frames medical QA as low-trust reference', () => {
    const prompt = buildAssistantSystemPrompt(READ_TOOLS);
    expect(prompt).toContain('open corpus of low-trust');
    expect(prompt).toContain('Trust layering for knowledge answers');
    expect(prompt).not.toContain('curated medical Q&A database');
  });

  it('simple-chat prompt forbids claiming data access', () => {
    const prompt = buildSimpleChatSystemPrompt();
    expect(prompt).toContain('No server-approved data tools are available');
    expect(prompt).toContain('Do not claim you inspected records');
    expect(prompt).not.toContain('Allowed tools in this run');
  });

  // ── AI safety policy edge-case tests ─────────────────────────────

  describe('AI safety policy edge cases', () => {
    const ALL_PROMPTS = [
      buildAssistantSystemPrompt(READ_TOOLS),
      buildReadSystemPrompt(READ_TOOLS),
      buildWriteSystemPrompt(['propose_create_daily_record']),
      buildKnowledgeSystemPrompt([
        'search_cn_medicine_products',
        'search_medicine_leaflets',
      ]),
      buildSimpleChatSystemPrompt(),
    ];

    it('every prompt forbids diagnosing diseases', () => {
      for (const prompt of ALL_PROMPTS) {
        expect(prompt).toContain('Do not diagnose diseases');
      }
    });

    it('every prompt forbids changing medication plans', () => {
      for (const prompt of ALL_PROMPTS) {
        expect(prompt).toMatch(/change medication plans/);
      }
    });

    it('every prompt forbids fabricating facts when context is missing', () => {
      // Every sub-graph must contain a prohibition against fabrication:
      // - "invent" (assistant/read/knowledge)
      // - "improvise" (write)
      // - "Do not claim you inspected" (simple-chat)
      for (const prompt of ALL_PROMPTS) {
        const forbidsFabrication =
          prompt.includes('invent') ||
          prompt.includes('improvise') ||
          prompt.includes('Do not claim');
        expect(forbidsFabrication).toBe(true);
      }
    });

    it('every prompt establishes identity as the Luminous health chat assistant', () => {
      for (const prompt of ALL_PROMPTS) {
        expect(prompt).toContain('You are the Luminous health chat assistant.');
      }
    });

    it('every prompt restricts facts to user-recorded or tool-returned data', () => {
      for (const prompt of ALL_PROMPTS) {
        expect(prompt).toContain(
          'Only use facts recorded by the user or returned by allowed tools.',
        );
      }
    });

    it('knowledge prompt forbids prescribing medications', () => {
      const prompt = buildKnowledgeSystemPrompt([
        'search_cn_medicine_products',
      ]);
      expect(prompt).toMatch(/do not diagnose/i);
      expect(prompt).toContain('not permission to diagnose or prescribe');
    });

    it('write prompt does not grant autonomous write authority', () => {
      const prompt = buildWriteSystemPrompt(['propose_create_daily_record']);
      // Proposals are drafts, never applied
      expect(prompt).toContain('Proposal tools do not perform writes.');
      expect(prompt).toContain('Never describe a proposal as already applied.');
      // Missing target is a refusal, not improvisation
      expect(prompt).toContain('refusal to guess the write target');
    });

    it('assistant prompt enforces trust layering for medical evidence', () => {
      const prompt = buildAssistantSystemPrompt([
        'search_cn_medicine_products',
        'search_medicine_leaflets',
      ]);
      // Trust hierarchy must be stated
      expect(prompt).toContain('Trust layering for knowledge answers');
      expect(prompt).toContain('package-insert facts');
      expect(prompt).toContain('scientific grounding');
      expect(prompt).toContain('open corpus of low-trust');
    });
  });
});
