import { z } from 'zod';
import {
  MedicineSource,
  SexAtBirth,
  UnitSystem,
  UserAllergyKind,
  UserAllergySeverity,
  UserConditionStatus,
} from '#generated/prisma/client.js';

/**
 * Standard Schema (zod 4) for the summary block of the health-context
 * aggregate. Replaces the former module-private `UserHealthSummaryDto`
 * response class.
 */
const userHealthSummarySchema = z.object({
  age: z
    .number()
    .nullable()
    .describe('Age derived from birth date. Null when birth date is missing.'),
  onboardingCompleted: z
    .boolean()
    .describe('Whether the onboarding flow has been completed.'),
  activeAllergyCount: z
    .number()
    .describe('Number of active allergy records returned in this payload.'),
  conditionCount: z
    .number()
    .describe('Number of condition records returned in this payload.'),
  currentMedicineCount: z
    .number()
    .describe('Number of current medicine records returned in this payload.'),
  missingCoreProfileFields: z
    .array(z.string())
    .describe(
      'Missing core profile fields that the frontend can use for onboarding nudges.',
    ),
});

/**
 * Standard Schema (zod 4) for the emergency-contact block of the health
 * profile. Replaces the former module-private `EmergencyContactDto` response
 * class.
 */
const emergencyContactSchema = z.object({
  name: z.string().nullable().describe('Emergency contact name.'),
  phone: z.string().nullable().describe('Emergency contact phone.'),
});

/**
 * Standard Schema (zod 4) for the profile block of the health-context
 * aggregate. Replaces the former module-private `UserHealthProfileDto`
 * response class.
 */
const userHealthProfileSchema = z.object({
  birthDate: z.string().nullable().describe('Birth date in YYYY-MM-DD format.'),
  sexAtBirth: z.enum(SexAtBirth).nullable().describe('Sex assigned at birth.'),
  heightCm: z.number().nullable().describe('Height in centimeters.'),
  weightKg: z
    .number()
    .nullable()
    .describe('Weight in kilograms. Extracted from extras JSONB.'),
  bloodType: z.string().nullable().describe('Blood type.'),
  locale: z.string().nullable().describe('Preferred locale.'),
  timezone: z.string().nullable().describe('Preferred timezone.'),
  unitSystem: z.enum(UnitSystem).nullable().describe('Preferred unit system.'),
  onboardingCompletedAt: z
    .string()
    .nullable()
    .describe('When the onboarding flow was completed.'),
  emergencyContact: emergencyContactSchema
    .nullable()
    .describe('Emergency contact extracted from extras JSONB.'),
  extras: z.unknown().describe('Sparse profile extensions stored in jsonb.'),
});

/**
 * Standard Schema (zod 4) for one allergy item of the health-context
 * aggregate. Replaces the former module-private `UserAllergyItemDto`
 * response class.
 */
const userAllergyItemSchema = z.object({
  id: z.string().describe('Allergy id.'),
  kind: z.enum(UserAllergyKind).describe('Allergy kind.'),
  label: z.string().describe('User-visible allergy label.'),
  reaction: z.string().nullable().describe('Recorded reaction.'),
  severity: z.enum(UserAllergySeverity).nullable().describe('Severity level.'),
  isActive: z.boolean().describe('Whether the allergy is currently active.'),
  note: z.string().nullable().describe('User note for the allergy.'),
  extras: z.unknown().describe('Sparse allergy extensions stored in jsonb.'),
  recordedAt: z.string().nullable().describe('When this allergy was recorded.'),
  createdAt: z.string().describe('Created time in ISO 8601 format.'),
  updatedAt: z.string().describe('Updated time in ISO 8601 format.'),
});

/**
 * Standard Schema (zod 4) for one condition item of the health-context
 * aggregate. Replaces the former module-private `UserConditionItemDto`
 * response class.
 */
const userConditionItemSchema = z.object({
  id: z.string().describe('Condition id.'),
  label: z.string().describe('Condition label.'),
  status: z.enum(UserConditionStatus).describe('Condition status.'),
  diagnosedAt: z
    .string()
    .nullable()
    .describe('Diagnosis date in YYYY-MM-DD format.'),
  resolvedAt: z
    .string()
    .nullable()
    .describe('Resolved date in YYYY-MM-DD format.'),
  note: z.string().nullable().describe('User note for the condition.'),
  extras: z.unknown().describe('Sparse condition extensions stored in jsonb.'),
  createdAt: z.string().describe('Created time in ISO 8601 format.'),
  updatedAt: z.string().describe('Updated time in ISO 8601 format.'),
});

/**
 * Standard Schema (zod 4) for one current-medicine item of the health-context
 * aggregate. Replaces the former module-private
 * `UserCurrentMedicineItemDto` response class.
 */
const userCurrentMedicineItemSchema = z.object({
  id: z.string().describe('Current medicine id.'),
  source: z
    .enum(MedicineSource)
    .describe('Upstream source used to anchor this medicine.'),
  sourceRefId: z.string().nullable().describe('Source-specific reference id.'),
  displayName: z.string().describe('Display name shown to the user.'),
  strengthText: z.string().nullable().describe('Strength text.'),
  doseText: z.string().nullable().describe('Dose text.'),
  route: z.string().nullable().describe('Administration route.'),
  startedAt: z.string().nullable().describe('Start date in YYYY-MM-DD format.'),
  endedAt: z.string().nullable().describe('End date in YYYY-MM-DD format.'),
  isCurrent: z.boolean().describe('Whether the medicine is currently active.'),
  note: z.string().nullable().describe('User note for the medicine.'),
  sourcePayload: z
    .unknown()
    .describe('Original source payload stored in jsonb.'),
  createdAt: z.string().describe('Created time in ISO 8601 format.'),
  updatedAt: z.string().describe('Updated time in ISO 8601 format.'),
});

/**
 * Standard Schema (zod 4) for the full health-context aggregate returned by
 * every `/health-context` endpoint (GET, profile/allergy/condition/medicine
 * writes). Replaces the former `HealthContextDataDto` /
 * `HealthContextResponseDto` response classes.
 */
export const healthContextResponseSchema = z.object({
  summary: userHealthSummarySchema,
  profile: userHealthProfileSchema,
  allergies: z.array(userAllergyItemSchema),
  conditions: z.array(userConditionItemSchema),
  currentMedicines: z.array(userCurrentMedicineItemSchema),
});

/** Strongly typed health-context aggregate payload. */
export type HealthContextDataDto = z.infer<typeof healthContextResponseSchema>;

/** Backwards-compatible response alias for the health-context endpoints. */
export type HealthContextResponseDto = HealthContextDataDto;

/** Backwards-compatible data alias kept for in-module references. */
export type HealthContextResponseData = HealthContextDataDto;
