import type { PromptCopy } from '../../../common/index.js';

export type MedicineRiskLlmPromptCopy = PromptCopy;

export interface MedicineRiskLlmContext {
  medicines: Array<{
    name: string;
    source: 'drugbank' | 'cn';
    ingredients?: string;
    contraindications?: string;
    precautions?: string;
    foodInteractions?: string[];
    drugInteractions?: Array<{ target: string; description: string }>;
    startedAt?: string;
  }>;
  allergies: Array<{
    label: string;
    severity: string;
    reaction?: string;
  }>;
  conditions: Array<{
    label: string;
    status: string;
  }>;
  reminders: Array<{
    medicineName: string;
    scheduledHour: number;
    scheduledMinute: number;
    daysOfWeek?: number[];
    startDate?: string;
    endDate?: string;
  }>;
  staticFindings: Array<{
    type: string;
    severity: string;
    description: string;
  }>;
}

export function buildMedicineRiskSystemPrompt(): string {
  return [
    'You are a medicine safety analyst.',
    'Use the provided medicine details, allergies, conditions, and reminders to identify medication risks.',
    'Identify risks including: drug interactions, duplicate ingredients, allergy matches,',
    'food interactions (alcohol, caffeine), long-term use risks (addiction, tolerance, dependency),',
    'scheduling conflicts (e.g., same ingredient taken too close together),',
    'and special population contraindications (pregnancy, lactation, pediatric, geriatric).',
    'The static findings are provided as baseline — expand on them, do not contradict them.',
    'Do not recommend starting, stopping, or changing medication doses.',
    'Keep recommendations practical and non-prescriptive (e.g., "consult your doctor about...").',
    'Return only structured output matching the required schema.',
  ].join(' ');
}

export function buildMedicineRiskUserPrompt(
  context: MedicineRiskLlmContext,
  _copy: MedicineRiskLlmPromptCopy,
): string {
  const medicines = context.medicines
    .map((m) => {
      const lines = [`- ${m.name} (source: ${m.source})`];
      if (m.ingredients) lines.push(`\n  Ingredients: ${m.ingredients}`);
      if (m.contraindications)
        lines.push(`\n  Contraindications: ${m.contraindications}`);
      if (m.precautions) lines.push(`\n  Precautions: ${m.precautions}`);
      if (m.foodInteractions && m.foodInteractions.length > 0)
        lines.push(`\n  Food interactions: ${m.foodInteractions.join('; ')}`);
      if (m.drugInteractions && m.drugInteractions.length > 0)
        lines.push(
          `\n  Drug interactions: ${m.drugInteractions
            .map((d) => `${d.target}: ${d.description}`)
            .join('; ')}`,
        );
      if (m.startedAt) lines.push(`\n  Started: ${m.startedAt}`);
      return lines.join('');
    })
    .join('\n');

  const allergies = context.allergies
    .map((a) =>
      a.reaction
        ? `- ${a.label} (severity: ${a.severity}) reaction: ${a.reaction}`
        : `- ${a.label} (severity: ${a.severity})`,
    )
    .join('\n');

  const conditions = context.conditions
    .map((c) => `- ${c.label} (status: ${c.status})`)
    .join('\n');

  const reminders = context.reminders
    .map((r) => {
      const lines = [
        `- ${r.medicineName} at ${String(r.scheduledHour).padStart(2, '0')}:${String(r.scheduledMinute).padStart(2, '0')}`,
      ];
      if (r.daysOfWeek && r.daysOfWeek.length > 0)
        lines.push(` on days: ${r.daysOfWeek.join(',')}`);
      else lines.push(' (daily)');
      if (r.startDate) lines.push(` from ${r.startDate}`);
      if (r.endDate) lines.push(` until ${r.endDate}`);
      return lines.join('');
    })
    .join('\n');

  const staticFindings = context.staticFindings
    .map((f) => `- [${f.severity}] ${f.type}: ${f.description}`)
    .join('\n');

  return [
    '## Current Medicines',
    medicines || '(none)',
    '',
    '## Allergies',
    allergies || '(none)',
    '',
    '## Conditions',
    conditions || '(none)',
    '',
    '## Reminders',
    reminders || '(none)',
    '',
    '## Static Check Findings (baseline)',
    staticFindings || '(none)',
    '',
    '## Task',
    'Analyze the above data for medicine safety risks.',
    'Consider long-term use patterns, addiction potential, tolerance, scheduling conflicts,',
    'and special population contraindications based on the conditions provided.',
    'Provide a risk score (0-100), risk level, findings with recommendations, and an overall recommendation.',
  ].join('\n');
}
