import { describe, expect, it } from 'vitest';
import {
  buildMedicineRiskSystemPrompt,
  buildMedicineRiskUserPrompt,
  type MedicineRiskLlmContext,
} from './risk-check.prompt.js';

const ctx: MedicineRiskLlmContext = {
  medicines: [
    {
      name: '布洛芬',
      source: 'cn',
      ingredients: '布洛芬',
      contraindications: '胃溃疡',
      precautions: '饭后服用',
      foodInteractions: ['酒'],
      drugInteractions: [{ target: 'DB0001', description: 'x' }],
      startedAt: '2026-01-01',
    },
  ],
  allergies: [{ label: '青霉素', severity: 'unknown', reaction: '皮疹' }],
  conditions: [{ label: '高血压', status: 'active' }],
  reminders: [
    {
      medicineName: '布洛芬',
      scheduledHour: 8,
      scheduledMinute: 30,
      daysOfWeek: [1, 3],
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    },
  ],
  staticFindings: [
    { type: 'allergy', severity: 'high', description: '匹配青霉素' },
  ],
};

describe('buildMedicineRiskSystemPrompt', () => {
  it('contains analyst role and safety boundaries', () => {
    const prompt = buildMedicineRiskSystemPrompt();
    expect(prompt).toContain('medicine safety analyst');
    expect(prompt).toContain('Do not recommend starting, stopping');
    expect(prompt).toContain('structured output');
  });
});

describe('buildMedicineRiskUserPrompt', () => {
  it('serializes medicines, allergies, conditions, reminders, findings', () => {
    const prompt = buildMedicineRiskUserPrompt(ctx, {} as never);
    expect(prompt).toContain('## Current Medicines');
    expect(prompt).toContain('- 布洛芬 (source: cn)');
    expect(prompt).toContain('Ingredients: 布洛芬');
    expect(prompt).toContain('Drug interactions: DB0001: x');
    expect(prompt).toContain('- 青霉素 (severity: unknown) reaction: 皮疹');
    expect(prompt).toContain('- 高血压 (status: active)');
    expect(prompt).toContain(
      '- 布洛芬 at 08:30 on days: 1,3 from 2026-01-01 until 2026-02-01',
    );
    expect(prompt).toContain('- [high] allergy: 匹配青霉素');
  });

  it('renders (none) placeholders for empty sections', () => {
    const prompt = buildMedicineRiskUserPrompt(
      {
        medicines: [],
        allergies: [],
        conditions: [],
        reminders: [],
        staticFindings: [],
      },
      {} as never,
    );
    expect(prompt).toContain('(none)');
  });
});
