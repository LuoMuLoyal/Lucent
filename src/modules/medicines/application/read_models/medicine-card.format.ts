/**
 * Knowledge-view formatting helpers (`application/read_models`).
 *
 * Shared by the persistence implementations (which build the projections) and
 * the HTTP presenters (which shape small transport concerns). They live in the
 * application layer because infrastructure is forbidden from importing
 * `adapters/` — building a read-model field is a projection concern, not a
 * delivery concern, so this is where both sides can legitimately meet.
 *
 * Everything here is a pure function over already-fetched values.
 */

import type {
  MedicineExternalIdentifier,
  MedicineExternalLink,
  MedicineInteraction,
  MedicinePage,
} from '../ports/knowledge-view.js';

const DEFAULT_SUMMARY_LENGTH = 180;

/**
 * Like `toStringList`, but returns `null` instead of `[]` when the source is
 * empty. The detail contract distinguishes "absent" from "empty list" for
 * optional arrays.
 */
export function toStringListOrNull(value: unknown): string[] | null {
  const list = toStringList(value);
  return list.length > 0 ? list : null;
}

export function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item: unknown) => {
    if (typeof item === 'string') {
      const normalized = item.trim();
      return normalized ? [normalized] : [];
    }

    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      const candidate = [
        record['name'],
        record['title'],
        record['code'],
        record['id'],
      ].find((entry) => typeof entry === 'string');

      if (typeof candidate === 'string') {
        const normalized = candidate.trim();
        return normalized ? [normalized] : [];
      }
    }

    return [];
  });
}

export function uniqueNonEmptyStrings(
  values: Array<string | null | undefined>,
  limit?: number,
): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) {
      continue;
    }

    unique.add(normalized);
    if (limit !== undefined && unique.size >= limit) {
      break;
    }
  }

  return [...unique];
}

export function composeSubtitle(
  ...parts: Array<string | null | undefined>
): string | null {
  const normalized = uniqueNonEmptyStrings(parts);
  return normalized.length > 0 ? normalized.join(' / ') : null;
}

export function firstNonEmpty(
  ...values: Array<string | null | undefined>
): string | null {
  return uniqueNonEmptyStrings(values, 1)[0] ?? null;
}

export function truncateText(
  value: string | null | undefined,
  maxLength = DEFAULT_SUMMARY_LENGTH,
): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function detectMatchedBy(
  query: string,
  candidates: Array<{ key: string; value: string | null | undefined }>,
): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return candidates.flatMap(({ key, value }) => {
    const normalizedValue = value?.trim().toLowerCase();
    return normalizedValue?.includes(normalizedQuery) ? [key] : [];
  });
}

export function toPagination(
  page: number,
  pageSize: number,
  total: number,
): MedicinePage {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export function toDrugbankDrugInteractions(
  value: unknown,
): MedicineInteraction[] | null {
  return toTypedJsonArray(value, (item): MedicineInteraction | null => {
    const record = asRecord(item);
    if (
      record != null &&
      typeof record['drugbankId'] === 'string' &&
      typeof record['description'] === 'string'
    ) {
      return {
        drugbankId: record['drugbankId'],
        description: record['description'],
      };
    }
    return null;
  });
}

/**
 * Maps the raw `external_identifiers` JSON column to the projected shape.
 *
 * The source stores `[{ resource, identifier }]`; entries missing either half
 * are dropped rather than surfacing a half-populated row.
 */
export function toDrugbankExternalIdentifiers(
  value: unknown,
): MedicineExternalIdentifier[] | null {
  return toTypedJsonArray(value, (item): MedicineExternalIdentifier | null => {
    const record = asRecord(item);
    if (
      record != null &&
      typeof record['resource'] === 'string' &&
      typeof record['identifier'] === 'string'
    ) {
      return {
        resource: record['resource'],
        identifier: record['identifier'],
      };
    }
    return null;
  });
}

/** Maps the raw `external_links` JSON column to the projected shape. */
export function toDrugbankExternalLinks(
  value: unknown,
): MedicineExternalLink[] | null {
  return toTypedJsonArray(value, (item): MedicineExternalLink | null => {
    const record = asRecord(item);
    if (
      record != null &&
      typeof record['resource'] === 'string' &&
      typeof record['url'] === 'string'
    ) {
      return { resource: record['resource'], url: record['url'] };
    }
    return null;
  });
}

/**
 * Filters a raw JSON array through a per-entry guard, returning `null` when
 * the source is absent or nothing survives the guard.
 *
 * The three DrugBank typed-array columns (`drug_interactions`,
 * `external_identifiers`, `external_links`) all follow the same shape:
 * guard each entry, drop the ones that fail, keep the rest.
 */
function toTypedJsonArray<T>(
  value: unknown,
  guard: (raw: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const typed: T[] = [];
  for (const item of value) {
    const mapped = guard(item);
    if (mapped !== null) {
      typed.push(mapped);
    }
  }

  return typed.length > 0 ? typed : null;
}

/** A plain JSON object, or `null` for arrays / primitives / null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
