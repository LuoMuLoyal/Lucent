import type { PromptCopy } from '../../../common';

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
    .map(
      (m) =>
        `- ${m.name} (source: ${m.source})` +
        (m.ingredients ? `\n  Ingredients: ${m.ingredients}` : '') +
        (m.contraindications
          ? `\n  Contraindications: ${m.contraindications}`
          : '') +
        (m.precautions ? `\n  Precautions: ${m.precautions}` : '') +
        (m.foodInteractions && m.foodInteractions.length > 0
          ? `\n  Food interactions: ${m.foodInteractions.join('; ')}`
          : '') +
        (m.drugInteractions && m.drugInteractions.length > 0
          ? `\n  Drug interactions: ${m.drugInteractions.map((d) => `${d.target}: ${d.description}`).join('; ')}`
          : '') +
        (m.startedAt ? `\n  Started: ${m.startedAt}` : ''),
    )
    .join('\n');

  const allergies = context.allergies
    .map(
      (a) =>
        `- ${a.label} (severity: ${a.severity})` +
        (a.reaction ? ` reaction: ${a.reaction}` : ''),
    )
    .join('\n');

  const conditions = context.conditions
    .map((c) => `- ${c.label} (status: ${c.status})`)
    .join('\n');

  const reminders = context.reminders
    .map(
      (r) =>
        `- ${r.medicineName} at ${String(r.scheduledHour).padStart(2, '0')}:${String(r.scheduledMinute).padStart(2, '0')}` +
        (r.daysOfWeek && r.daysOfWeek.length > 0
          ? ` on days: ${r.daysOfWeek.join(',')}`
          : ' (daily)') +
        (r.startDate ? ` from ${r.startDate}` : '') +
        (r.endDate ? ` until ${r.endDate}` : ''),
    )
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
