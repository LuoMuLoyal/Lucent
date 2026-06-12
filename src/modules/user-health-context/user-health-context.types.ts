import type { Prisma } from '../../generated/prisma/client';

export const CORE_PROFILE_FIELDS = [
  'birthDate',
  'sexAtBirth',
  'heightCm',
  'unitSystem',
] as const;

export const userHealthContextInclude = {
  profile: true,
  allergies: {
    where: {
      isActive: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  },
  conditions: {
    orderBy: {
      updatedAt: 'desc',
    },
  },
  currentMedicines: {
    where: {
      isCurrent: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  },
} satisfies Prisma.UserInclude;

export type UserHealthContextRecord = Prisma.UserGetPayload<{
  include: typeof userHealthContextInclude;
}>;
