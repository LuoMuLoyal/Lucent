import type { Prisma } from '#generated/prisma/client';
import type { DrugbankDrugInteractionDto } from '../dto/medicine-detail.dto';

const DEFAULT_SUMMARY_LENGTH = 180;

export function toStringList(
  value: Prisma.JsonValue | null | undefined,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item === 'string') {
      const normalized = item.trim();
      return normalized ? [normalized] : [];
    }

    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const candidate = [
        item['name'],
        item['title'],
        item['code'],
        item['id'],
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
): { page: number; pageSize: number; total: number; totalPages: number } {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export function toDrugbankDrugInteractions(
  value: Prisma.JsonValue | null | undefined,
): DrugbankDrugInteractionDto[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const interactions: DrugbankDrugInteractionDto[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof item['drugbankId'] === 'string' &&
      typeof item['description'] === 'string'
    ) {
      interactions.push({
        drugbankId: item['drugbankId'],
        description: item['description'],
      });
    }
  }

  return interactions.length > 0 ? interactions : null;
}
