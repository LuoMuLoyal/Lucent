import { z } from 'zod';

/**
 * Session list response schemas for `GET /api/v1/auth/sessions`.
 *
 * The endpoint returns a JSON array of session items. Outbound validation
 * uses the item schema (the global serializer validates array items one by
 * one); the array schema backs the OpenAPI registration (component keeps the
 * former `SessionListItemDto` class name).
 */

/** Replaces `SessionListItemDto`. */
export const sessionListItemSchema = z.object({
  id: z.string().describe('Session id'),
  deviceType: z.string().nullable().describe('Device type'),
  deviceName: z.string().nullable().describe('Device name'),
  platform: z.string().nullable().describe('Platform'),
  lastUsedAt: z.string().nullable().describe('Last used at (ISO-8601)'),
  createdAt: z.string().describe('Created at (ISO-8601)'),
  expiresAt: z.string().describe('Expires at (ISO-8601)'),
  isCurrent: z.boolean().describe('Whether this is the current session'),
});

/** Strongly typed single active-session entry. */
export type SessionListItemDto = z.infer<typeof sessionListItemSchema>;

/**
 * Array schema of the `GET /auth/sessions` success body — the full response
 * JSON is a bare array of {@link sessionListItemSchema}. Used for the OpenAPI
 * registration only; runtime validation is per item.
 */
export const sessionListSchema = z
  .array(sessionListItemSchema)
  .describe('The active sessions of the current user.');
