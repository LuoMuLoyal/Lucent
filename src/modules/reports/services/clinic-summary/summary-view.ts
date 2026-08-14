import type { ClinicSummaryShareField } from '#generated/prisma/client';
import type { ClinicSummaryDto } from '../../dto/clinic-summary-response.dto';

/**
 * Shared selected-field view model for the clinic summary.
 *
 * preview (service response), PDF input and the shared payload all consume
 * this single filter, so deselected fields cannot drift between the three
 * output paths. Metadata (generatedAt / scopeLabel / start / end /
 * selectedFields / coverage / findings / disclaimer) is always present;
 * only the four data sections are selectable.
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
 * Problem-oriented share-field → summary section mapping (Task 2 enum
 * vocabulary → the current DTO section keys). `water` / `sleep` / `notes`
 * have no standalone DTO section yet — their data lives inside `findings`
 * (single array) and `coverage` (always included), so they map to no
 * section. `allergies` is deliberately NOT a selectable share field: like
 * `findings` and `coverage` it is always included in every output view (see
 * [resolveSectionKeys]). Selecting only the un-mapped fields yields a
 * metadata-only summary (allergies + findings + coverage) instead of an
 * error; the mapping is the single translation point the controller uses to
 * forward request-DTO values into the service. Partial because unknown enum
 * values may reach the resolver at runtime.
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
 * fields, so it must behave like the always-present metadata (findings /
 * coverage) rather than a section the owner can deselect — otherwise any
 * explicit selection would silently drop allergies from every output path
 * (preview / PDF / share).
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
  ClinicSummarySectionKey
> & {
  [K in ClinicSummarySectionKey]: ClinicSummaryDto[K] | undefined;
};

/**
 * Returns the summary restricted to the selected sections. An empty or
 * absent selection keeps every section. Deselected sections are set to
 * `undefined` (own properties), so no output path can leak them.
 */
export function applySelectedFields(
  summary: ClinicSummaryDto,
  selectedFields: readonly string[] | undefined,
): ClinicSummarySectionView {
  const keys =
    selectedFields == null || selectedFields.length === 0
      ? [...CLINIC_SUMMARY_SECTION_KEYS]
      : resolveSectionKeys(selectedFields);
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
  return {
    generatedAt: summary.generatedAt,
    dataRange: summary.dataRange,
    scopeLabel: summary.scopeLabel,
    start: summary.start,
    end: summary.end,
    selectedFields: keys,
    coverage: summary.coverage,
    ...(summary.findings != null ? { findings: summary.findings } : {}),
    disclaimer: summary.disclaimer,
    profile: sections.profile,
    allergies: sections.allergies,
    conditions: sections.conditions,
    currentMedicines: sections.currentMedicines,
  };
}
