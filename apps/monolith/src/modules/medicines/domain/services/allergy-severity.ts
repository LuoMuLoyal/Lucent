const anaphylaxisKeywords = new Set([
  'anaphylaxis',
  'anaphylactic',
  '过敏性休克',
  '严重过敏',
  '重度过敏',
  '休克',
]);

export interface AllergyRecord {
  label: string;
  reaction: string | null;
  severity: string | null;
  isActive: boolean;
}

export function inferredAllergySeverity(allergy: AllergyRecord): string {
  const reaction = (allergy.reaction ?? '').toLowerCase();
  if ([...anaphylaxisKeywords].some((kw) => reaction.includes(kw))) {
    return 'severe';
  }
  const severity = allergy.severity?.toLowerCase().trim();
  if (severity == null || severity === '' || severity === 'unknown') {
    return 'unknown';
  }
  return severity;
}

export function isSevereAllergy(allergy: AllergyRecord): boolean {
  return inferredAllergySeverity(allergy) === 'severe';
}
