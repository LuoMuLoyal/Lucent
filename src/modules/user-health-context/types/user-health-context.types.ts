export const CORE_PROFILE_FIELDS = [
  'birthDate',
  'sexAtBirth',
  'heightCm',
  'unitSystem',
] as const;

export const userHealthContextInclude = {
  profile: true,
  allergies: {
    where: { isActive: true },
    orderBy: { updatedAt: 'desc' as const },
  },
  conditions: {
    orderBy: { updatedAt: 'desc' as const },
  },
  currentMedicines: {
    where: { isCurrent: true },
    orderBy: { updatedAt: 'desc' as const },
  },
};

export type UserHealthContextRecord = {
  profile: {
    birthDate: Date | null;
    sexAtBirth: string | null;
    heightCm: number | null;
    pregnancyState: string | null;
    lactationState: string | null;
    bloodType: string | null;
    locale: string | null;
    timezone: string | null;
    unitSystem: string | null;
    onboardingCompletedAt: Date | null;
    extras: Record<string, unknown> | null;
  } | null;
  allergies: Array<{
    id: string;
    kind: string;
    label: string;
    reaction: string | null;
    severity: string | null;
    isActive: boolean;
    note: string | null;
    extras: Record<string, unknown> | null;
    recordedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  conditions: Array<{
    id: string;
    label: string;
    status: string;
    diagnosedAt: Date | null;
    resolvedAt: Date | null;
    note: string | null;
    extras: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  currentMedicines: Array<{
    id: string;
    source: string;
    sourceRefId: string | null;
    displayName: string;
    strengthText: string | null;
    doseText: string | null;
    route: string | null;
    startedAt: Date | null;
    endedAt: Date | null;
    isCurrent: boolean;
    note: string | null;
    sourcePayload: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
};
