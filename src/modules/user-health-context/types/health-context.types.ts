import type { Prisma } from '#generated/prisma/client.js';

export const CORE_PROFILE_FIELDS = [
  'birthDate',
  'sexAtBirth',
  'heightCm',
  'unitSystem',
] as const;

/** Dietary preference whitelist stored in extras JSONB (array, ≤5 items). */
export const DIETARY_PREFERENCE_VALUES = [
  'vegetarian',
  'vegan',
  'lowCarb',
  'lowSalt',
  'lowFat',
  'highProtein',
  'keto',
  'halal',
  'other',
] as const;

export type DietaryPreference = (typeof DIETARY_PREFERENCE_VALUES)[number];

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
} satisfies Prisma.UserInclude;

export type UserHealthContextRecord = Prisma.UserGetPayload<{
  include: typeof userHealthContextInclude;
}>;
