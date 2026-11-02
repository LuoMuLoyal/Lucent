/**
 * Medicine risk LLM contract (`application/ports`).
 *
 * The context/output types live here because both the application use case
 * (`check_risk`), the prompt builder and the generator implementation need
 * them — without importing each other's trees.
 */

import type { PromptCopy } from '../../../../common/index.js';

export const MEDICINE_RISK_LLM_GENERATOR = 'MEDICINE_RISK_LLM_GENERATOR';

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

export interface MedicineRiskLlmFinding {
  type:
    | 'interaction'
    | 'duplicateIngredient'
    | 'allergy'
    | 'foodInteraction'
    | 'longTermUse'
    | 'schedulingConflict'
    | 'specialGroup';
  severity: 'high' | 'medium' | 'info';
  title: string;
  description: string;
  recommendation: string;
  primaryMedicineName: string;
  secondaryMedicineName?: string | undefined;
}

/**
 * Structured output of one LLM risk check.
 *
 * Declared as a type alias rather than an interface: the alias form carries an
 * implicit index signature, which is what `BaseLlmGeneratorService`'s
 * `TOutput extends Record<string, unknown>` constraint requires.
 */
export type MedicineRiskLlmOutput = {
  summary: string;
  riskScore: number;
  riskLevel: 'safe' | 'caution' | 'risk' | 'danger';
  findings: MedicineRiskLlmFinding[];
  overallRecommendation: string;
};

export interface MedicineRiskLlmPort {
  hasAnalysisModel(): boolean;
  generate(
    context: MedicineRiskLlmContext,
    promptCopy: MedicineRiskLlmPromptCopy,
  ): Promise<MedicineRiskLlmOutput>;
}
