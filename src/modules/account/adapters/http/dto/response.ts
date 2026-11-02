import { z } from 'zod';

/**
 * Standard Schema (zod 4) for one linked third-party identity inside the
 * account resource. Replaces the former `AccountIdentityDto` response class.
 * Response schemas intentionally carry no `.strict()` / `.default()` so
 * outbound parsing tolerates whatever the service layer produces.
 */
export const accountIdentitySchema = z.object({
  id: z.string().describe('Account identity ID.'),
  provider: z.string().describe('OAuth provider name.'),
  email: z
    .string()
    .nullable()
    .describe('Provider email when the provider exposes one.'),
  emailVerifiedAt: z
    .string()
    .nullable()
    .describe('Provider email verification time in ISO 8601.'),
  linkedAt: z.string().describe('Identity linked time in ISO 8601.'),
});

/**
 * Standard Schema (zod 4) for the authenticated account profile resource
 * (`GET`/`PATCH /account`, identity link/unlink callbacks).
 *
 * Replaces the former `AccountDto` response class.
 */
export const accountDataSchema = z.object({
  id: z.string().describe('User ID.'),
  email: z
    .string()
    .nullable()
    .describe('Account email. OAuth-only accounts may not have one.'),
  nickname: z.string().nullable().describe('Display nickname.'),
  avatar: z.string().nullable().describe('Avatar URL.'),
  emailVerifiedAt: z
    .string()
    .nullable()
    .describe('Account email verification time in ISO 8601.'),
  hasPassword: z
    .boolean()
    .describe('Whether the account has a local password.'),
  lastLoginAt: z.string().nullable().describe('Last login time in ISO 8601.'),
  linkedIdentities: z
    .array(accountIdentitySchema)
    .describe('Linked third-party identities without provider user ids.'),
  createdAt: z.string().describe('Created time in ISO 8601.'),
  updatedAt: z.string().describe('Updated time in ISO 8601.'),
});

/** Strongly typed authenticated account profile. */
export type AccountDto = z.infer<typeof accountDataSchema>;

/** Backwards-compatible response alias kept for the former DTO class name. */
export type AccountResponseDto = AccountDto;

/**
 * Standard Schema (zod 4) for the `POST /account/email` change-email result.
 *
 * Replaces the former `AccountEmailDataDto` response class.
 */
export const accountEmailDataSchema = z.object({
  email: z.string().describe('New email address.'),
  emailVerifiedAt: z
    .string()
    .nullable()
    .describe('Email verification time in ISO 8601.'),
});

/** Strongly typed account email change result. */
export type AccountEmailResponseDto = z.infer<typeof accountEmailDataSchema>;
