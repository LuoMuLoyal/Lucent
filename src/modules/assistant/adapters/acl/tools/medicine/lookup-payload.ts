import type { Logger } from '@nestjs/common';
import { parseSearchPayload } from '../drugbank/entity-resolve.service.js';

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

export function parseLookupPayload(
  raw: string,
  logger: Logger,
): {
  query: string;
  limit: number | undefined;
  productId: string | null;
  drugbankId: string | null;
} {
  const base = parseSearchPayload(raw, logger);
  const trimmed = raw.trim();

  if (!trimmed.startsWith('{')) {
    return {
      query: base.query,
      limit: base.limit,
      productId: readString(base.filters['productId']),
      drugbankId: readString(base.filters['drugbankId']),
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const id = readString(parsed['id']);
    return {
      query: base.query,
      limit: base.limit,
      productId:
        readString(parsed['productId']) ??
        readString(base.filters['productId']) ??
        id,
      drugbankId:
        readString(parsed['drugbankId']) ??
        readString(base.filters['drugbankId']) ??
        id,
    };
  } catch (error) {
    logger.warn(
      `Failed to parse lookup payload, returning base query: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      query: base.query,
      limit: base.limit,
      productId: readString(base.filters['productId']),
      drugbankId: readString(base.filters['drugbankId']),
    };
  }
}
