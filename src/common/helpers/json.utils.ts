/**
 * Shared JSON utilities.
 */

import type { Logger } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client';

/**
 * Extracts the outermost JSON object from a string that may contain
 * markdown fences or surrounding prose.
 */
export function extractJsonObject(rawText: string): string | null {
  const jsonStart = rawText.indexOf('{');
  const jsonEnd = rawText.lastIndexOf('}') + 1;
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return null;
  }

  return rawText.slice(jsonStart, jsonEnd);
}

/**
 * Safely parses a JSON object from LLM-generated text.
 *
 * Handles common LLM output patterns:
 * - Pure JSON
 * - JSON embedded in markdown code blocks
 * - JSON surrounded by explanatory text
 *
 * @param text - Raw LLM output that should contain a JSON object
 * @param options.logger - Optional Logger for warning on parse failure
 * @param options.context - Optional context string for log messages
 * @returns parsed object, or `null` if no valid JSON found
 */
export function safeParseLlmJson(
  text: string,
  options?: {
    logger?: Logger;
    context?: string;
  },
): Record<string, unknown> | null {
  const jsonText = extractJsonObject(text);
  if (jsonText == null) {
    if (options?.logger) {
      options.logger.warn(
        `No JSON object found in LLM response${options.context ? ` (${options.context})` : ''}`,
      );
    }
    return null;
  }

  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch (error) {
    if (options?.logger) {
      options.logger.warn(
        `Failed to parse LLM JSON${options.context ? ` (${options.context})` : ''}: ${(error as Error).message}`,
      );
    }
    return null;
  }
}

/**
 * Casts a value to `Prisma.InputJsonValue`.
 *
 * Use this instead of `value as Prisma.InputJsonValue` or
 * `value as unknown as Prisma.InputJsonValue` to centralise the cast
 * in a single place. If Prisma ever tightens its JSON type definitions,
 * only this function needs updating.
 *
 * The value must not be `null` or `undefined` — use
 * {@link toNullableInputJsonValue} for nullable values.
 */
export function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * Casts a nullable value to `Prisma.InputJsonValue | typeof Prisma.DbNull`.
 *
 * - `null` → `Prisma.DbNull` (explicit SQL NULL)
 * - `undefined` → `Prisma.DbNull` (treated as null for Prisma writes)
 * - otherwise → `toInputJsonValue(value)`
 *
 * Use this for optional JSON fields where `null` should clear the column
 * rather than leave it untouched.
 */
export function toNullableInputJsonValue(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) {
    return Prisma.DbNull;
  }
  return toInputJsonValue(value);
}
