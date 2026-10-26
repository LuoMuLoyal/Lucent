import type { ClinicSummaryShareField } from '#generated/prisma/client.js';
import type {
  ClinicSummaryDto,
  ClinicSummaryNoteEntryDto,
  ClinicSummarySleepEntryDto,
  ClinicSummaryWaterEntryDto,
} from '../../dto/clinic-summary-response.dto.js';

/**
 * Share-field keys that control non-section DTO fields (findings, coverage
 * sub-entries, and the new water/sleep/notes entry arrays). These fields do
 * NOT map to the four section keys — they are handled separately by
 * `applySelectedFields` so their data can be gated independently.
 */
export const CLINIC_SUMMARY_NON_SECTION_FIELDS = new Set<string>([
  'water',
  'sleep',
  'notes',
]);

/**
 * Shared selected-field view model for the clinic summary.
 *
 * preview (service response), PDF input and the shared payload all consume
 * this single filter, so deselected fields cannot drift between the three
 * output paths. Metadata (generatedAt / scopeLabel / start / end /
 * selectedFields / coverage[checkIns+dose] / disclaimer) is always present;
 * the four data sections, findings, water/sleep coverage, and
 * water/sleep/notes entry arrays are each controlled by their corresponding
 * share-field toggle.
 */
export const CLINIC_SUMMARY_SECTION_KEYS = [
  'profile',
  'allergies',
  'conditions',
  'currentMedicines',
] as const;

export type ClinicSummarySectionKey =
  (typeof CLINIC_SUMMARY_SECTION_KEYS)[number];

/**
 * Problem-oriented share-field → summary section mapping. The six share-field
 * enum values map as follows (R-2):
 *
 * - `event_overview` → `profile` (and findings, gated separately)
 * - `symptom_changes` → `conditions`
 * - `medication_slots` → `currentMedicines`
 * - `water` → no section (coverage.water + waterEntries, gated separately)
 * - `sleep` → no section (coverage.sleep + sleepEntries, gated separately)
 * - `notes` → no section (noteEntries, gated separately)
 *
 * `allergies` is deliberately NOT a selectable share field: it is always
 * included in every output view (see [resolveSectionKeys]).
 */
export const CLINIC_SUMMARY_SHARE_FIELD_SECTIONS: Partial<
  Record<ClinicSummaryShareField, ClinicSummarySectionKey[]>
> = {
  event_overview: ['profile'],
  symptom_changes: ['conditions'],
  medication_slots: ['currentMedicines'],
  water: [],
  sleep: [],
  notes: [],
};

/**
 * Resolves a raw field list (section keys OR the six share-field enum
 * values) into the effective section keys, preserving first-occurrence
 * order and deduplicating. Unknown values are ignored.
 *
 * `allergies` is always included: it is not one of the six selectable share
 * fields, so it must behave like the always-present metadata rather than a
 * section the owner can deselect.
 */
export function resolveSectionKeys(
  fields: readonly string[],
): ClinicSummarySectionKey[] {
  const resolved: ClinicSummarySectionKey[] = [];
  for (const field of fields) {
    const candidates: readonly ClinicSummarySectionKey[] = (
      CLINIC_SUMMARY_SECTION_KEYS as readonly string[]
    ).includes(field)
      ? [field as ClinicSummarySectionKey]
      : (CLINIC_SUMMARY_SHARE_FIELD_SECTIONS[
          field as ClinicSummaryShareField
        ] ?? []);
    for (const candidate of candidates) {
      if (!resolved.includes(candidate)) {
        resolved.push(candidate);
      }
    }
  }
  // Allergies are never selectable — always present, appended last so the
  // mapped selection keeps its first-occurrence order.
  if (!resolved.includes('allergies')) {
    resolved.push('allergies');
  }
  return resolved;
}

/**
 * Summary shape after field selection: metadata always, sections present as
 * explicit values or `undefined`. Deselected keys stay IN the object with
 * value `undefined` (never omitted), so serializers and `objectContaining`
 * assertions cannot confuse an absent key with an included section.
 */
export type ClinicSummarySectionView = Omit<
  ClinicSummaryDto,
  | ClinicSummarySectionKey
  | 'findings'
  | 'coverage'
  | 'waterEntries'
  | 'sleepEntries'
  | 'noteEntries'
> & {
  [K in ClinicSummarySectionKey]: ClinicSummaryDto[K] | undefined;
} & {
  findings?: string[];
  coverage: ClinicSummaryDto['coverage'];
  waterEntries?: ClinicSummaryWaterEntryDto[];
  sleepEntries?: ClinicSummarySleepEntryDto[];
  noteEntries?: ClinicSummaryNoteEntryDto[];
};

/**
 * Returns the summary restricted to the selected sections. An empty or
 * absent selection keeps every section. Deselected sections are set to
 * `undefined` (own properties), so no output path can leak them.
 *
 * R-2: Each of the six share-field toggles gates its own data:
 * - `event_overview` → profile section + findings
 * - `symptom_changes` → conditions section
 * - `medication_slots` → currentMedicines section
 * - `water` → coverage.water + waterEntries
 * - `sleep` → coverage.sleep + sleepEntries
 * - `notes` → noteEntries
 *
 * Coverage always includes `checkIns` and `dose` (not selectable). When
 * `water` or `sleep` is deselected, the corresponding coverage entry is
 * set to `undefined`.
 */
export function applySelectedFields(
  summary: ClinicSummaryDto,
  selectedFields: readonly string[] | undefined,
): ClinicSummarySectionView {
  const keys =
    selectedFields == null || selectedFields.length === 0
      ? [...CLINIC_SUMMARY_SECTION_KEYS]
      : resolveSectionKeys(selectedFields);

  // Determine which non-section fields are selected.
  const hasWater = selectedFields?.includes('water') ?? true;
  const hasSleep = selectedFields?.includes('sleep') ?? true;
  const hasNotes = selectedFields?.includes('notes') ?? false;
  const hasEventOverview =
    selectedFields?.includes('event_overview') ??
    (selectedFields == null || selectedFields.length === 0);

  const sections: {
    [K in ClinicSummarySectionKey]: ClinicSummaryDto[K] | undefined;
  } = {
    profile: undefined,
    allergies: undefined,
    conditions: undefined,
    currentMedicines: undefined,
  };
  if (keys.includes('profile')) {
    sections.profile = summary.profile;
  }
  if (keys.includes('allergies')) {
    sections.allergies = summary.allergies;
  }
  if (keys.includes('conditions')) {
    sections.conditions = summary.conditions;
  }
  if (keys.includes('currentMedicines')) {
    sections.currentMedicines = summary.currentMedicines;
  }

  // Coverage: always include checkIns + dose; gate water/sleep.
  const coverage: ClinicSummaryDto['coverage'] = {
    checkIns: summary.coverage.checkIns,
    dose: summary.coverage.dose,
    ...(hasWater && summary.coverage.water != null
      ? { water: summary.coverage.water }
      : {}),
    ...(hasSleep && summary.coverage.sleep != null
      ? { sleep: summary.coverage.sleep }
      : {}),
  };

  return {
    generatedAt: summary.generatedAt,
    dataRange: summary.dataRange,
    scopeLabel: summary.scopeLabel,
    start: summary.start,
    end: summary.end,
    selectedFields: keys,
    coverage,
    ...(hasEventOverview && summary.findings != null
      ? { findings: summary.findings }
      : {}),
    ...(hasWater && summary.waterEntries != null
      ? { waterEntries: summary.waterEntries }
      : {}),
    ...(hasSleep && summary.sleepEntries != null
      ? { sleepEntries: summary.sleepEntries }
      : {}),
    ...(hasNotes && summary.noteEntries != null
      ? { noteEntries: summary.noteEntries }
      : {}),
    disclaimer: summary.disclaimer,
    profile: sections.profile,
    allergies: sections.allergies,
    conditions: sections.conditions,
    currentMedicines: sections.currentMedicines,
  };
}
