import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';

const logger = new Logger('VectorCursor');

export interface AssistantVectorCursorPayload {
  offset: number;
  limit: number;
  queryHash: string;
}

export interface AssistantVectorPage {
  limit: number;
  offset: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export function encodeVectorCursor(
  payload: AssistantVectorCursorPayload,
): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeVectorCursor(
  cursor: string | null | undefined,
): AssistantVectorCursorPayload | null {
  if (!cursor) return null;

  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(raw) as AssistantVectorCursorPayload;
  } catch (error) {
    logger.warn(
      `Failed to decode vector cursor, returning null: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export function buildVectorQueryHash(
  query: string,
  filters: Record<string, unknown> = {},
): string {
  return createHash('sha256')
    .update(JSON.stringify({ query, filters }))
    .digest('hex');
}

export function buildVectorPage(input: {
  limit: number;
  offset: number;
  hasMore: boolean;
  queryHash: string;
}): AssistantVectorPage {
  return {
    limit: input.limit,
    offset: input.offset,
    hasMore: input.hasMore,
    nextCursor: input.hasMore
      ? encodeVectorCursor({
          offset: input.offset + input.limit,
          limit: input.limit,
          queryHash: input.queryHash,
        })
      : null,
  };
}
