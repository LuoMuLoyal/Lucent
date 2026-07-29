import type { MedicineDetailDataDto } from '../dto/medicine-detail.dto';

// ─── Canonical ingredient variant map ──────────────────────────────────────

const canonicalIngredientVariants: Record<string, Set<string>> = {
  acetaminophen: new Set([
    'acetaminophen',
    'paracetamol',
    '对乙酰氨基酚',
    '扑热息痛',
  ]),
  aspirin: new Set([
    'aspirin',
    'acetylsalicylicacid',
    '乙酰水杨酸',
    '阿司匹林',
  ]),
  ibuprofen: new Set(['ibuprofen', '布洛芬']),
  amoxicillin: new Set(['amoxicillin', '阿莫西林']),
  penicillin: new Set(['penicillin', '青霉素', '盘尼西林']),
  cephalosporin: new Set(['cephalosporin', '头孢', '先锋霉素']),
  sulfa: new Set(['sulfa', 'sulfonamide', '磺胺']),
  metformin: new Set(['metformin', '二甲双胍']),
  loratadine: new Set(['loratadine', '氯雷他定']),
  cetirizine: new Set(['cetirizine', '西替利嗪']),
  diphenhydramine: new Set(['diphenhydramine', '苯海拉明']),
  chlorpheniramine: new Set(['chlorpheniramine', '氯苯那敏', '扑尔敏']),
  pseudoephedrine: new Set(['pseudoephedrine', '伪麻黄碱']),
  dextromethorphan: new Set(['dextromethorphan', '右美沙芬']),
  guaifenesin: new Set(['guaifenesin', '愈创甘油醚']),
};

// ─── String helpers ──────────────────────────────────────────────────────────

export function normalizeToken(value: string): string {
  return value.toLowerCase().replaceAll(/\s+/g, '');
}

export function asNonEmptyString(value: unknown): string | null {
  const text = value?.toString().trim();
  if (text == null || text === '') return null;
  return text;
}

export function firstNonEmpty(
  a: string | null,
  b: string | null,
  c: string | null,
): string | null {
  if (a != null && a !== '') return a;
  if (b != null && b !== '') return b;
  if (c != null && c !== '') return c;
  return null;
}

// ─── Ingredient token extraction ─────────────────────────────────────────────

function cleanIngredientToken(raw: string): string | null {
  const withoutParens = raw.replaceAll(/\([^)]*\)/g, ' ');
  const withoutStrength = withoutParens.replaceAll(
    /\b\d+(\.\d+)?\s*(mg|g|ml|mcg|iu|%|片|粒|袋|支|丸)\b/gi,
    ' ',
  );
  const n = normalizeToken(
    withoutStrength.replaceAll(/[·.-]/g, ' ').replaceAll(/\s+/g, ' ').trim(),
  );
  if (n === '' || n.length <= 1) return null;
  return n;
}

export function extractIngredientTokens(value: string): Set<string> {
  const normalized = value
    .replaceAll('（', '(')
    .replaceAll('）', ')')
    .replaceAll('；', ';')
    .replaceAll('，', ',')
    .replaceAll('、', ',')
    .replaceAll('+', ',')
    .replaceAll(' and ', ',')
    .replaceAll(' AND ', ',');
  const parts = normalized.split(/[;,/\n\r+|]/);
  return new Set(
    [...parts].map(cleanIngredientToken).filter((v): v is string => v != null),
  );
}

// ─── Canonical key mapping ───────────────────────────────────────────────────

export function canonicalIngredientKeysFor(tokens: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const token of tokens) {
    let matched = false;
    for (const [key, variants] of Object.entries(canonicalIngredientVariants)) {
      const normalizedVariants = new Set([...variants].map(normalizeToken));
      if (normalizedVariants.has(token)) {
        result.add(key);
        matched = true;
        break;
      }
    }
    if (!matched) {
      result.add(token);
    }
  }
  return result;
}

export function expandCanonicalIngredientTokens(
  tokens: Set<string>,
): Set<string> {
  const result = new Set(tokens);
  for (const variants of Object.values(canonicalIngredientVariants)) {
    const normalizedVariants = new Set([...variants].map(normalizeToken));
    const intersection = [...normalizedVariants].filter((v) => tokens.has(v));
    if (intersection.length > 0) {
      for (const v of normalizedVariants) {
        result.add(v);
      }
    }
  }
  return result;
}

export function duplicateIngredientEvidence(sharedTokens: Set<string>): string {
  return [...sharedTokens].sort().join(' / ');
}

// ─── Medicine detail wrapper ─────────────────────────────────────────────────

export interface MedicineDetailWrapper {
  item: {
    id: string;
    source: string;
    sourceRefId: string | null;
    displayName: string;
    startedAt: Date | null;
  };
  detail: MedicineDetailDataDto;
}

export function getDisplayName(medicine: MedicineDetailWrapper): string {
  const name = medicine.item.displayName.trim();
  return name !== '' ? name : medicine.detail.name;
}

export function getDetailJson(
  detail: MedicineDetailDataDto,
): Record<string, unknown> {
  return detail.detail as unknown as Record<string, unknown>;
}

export function getNormalizedIngredientTokens(
  medicine: MedicineDetailWrapper,
): Set<string> {
  const json = getDetailJson(medicine.detail);
  if (medicine.item.source === 'cn') {
    const ingredients = asNonEmptyString(json['ingredients']);
    if (ingredients == null) return new Set();
    return extractIngredientTokens(ingredients);
  }
  if (medicine.item.source === 'drugbank') {
    return getDrugbankSynonymTokens(medicine);
  }
  return new Set();
}

export function getAllSourceIngredientTokens(
  medicine: MedicineDetailWrapper,
): Set<string> {
  const tokens = new Set<string>();
  for (const t of getCanonicalIngredientKeys(medicine)) {
    tokens.add(t);
  }
  tokens.add(normalizeToken(getDisplayName(medicine)));
  return tokens;
}

export function getCanonicalIngredientKeys(
  medicine: MedicineDetailWrapper,
): Set<string> {
  return canonicalIngredientKeysFor(getNormalizedIngredientTokens(medicine));
}

export function getDrugbankSynonymTokens(
  medicine: MedicineDetailWrapper,
): Set<string> {
  if (medicine.item.source !== 'drugbank') return new Set();
  const json = getDetailJson(medicine.detail);
  const names = medicine.detail.name.trim();
  const result = new Set<string>();
  if (names !== '') result.add(normalizeToken(names));
  const synonyms = (json['synonyms'] as unknown[] | undefined) ?? [];
  for (const synonym of synonyms) {
    const token = normalizeToken(String(synonym));
    if (token !== '') result.add(token);
  }
  return result;
}

export function getDrugbankIds(medicine: MedicineDetailWrapper): Set<string> {
  if (medicine.item.source === 'drugbank') {
    const id = medicine.item.sourceRefId;
    if (id == null || id === '') return new Set();
    return new Set([id]);
  }
  if (medicine.item.source === 'cn') {
    const json = getDetailJson(medicine.detail);
    const value = json['drugbankIds'] as unknown[] | undefined;
    if (value != null) {
      return new Set(
        value
          .map((entry) => String(entry).trim())
          .filter((entry) => entry !== ''),
      );
    }
  }
  return new Set();
}

export function getDrugbankInteractionTargets(
  medicine: MedicineDetailWrapper,
): Set<string> {
  if (medicine.item.source !== 'drugbank') return new Set();
  const json = getDetailJson(medicine.detail);
  const value = json['drugInteractions'];
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value
      .filter(
        (v): v is Record<string, unknown> => v != null && typeof v === 'object',
      )
      .map((entry) => entry['drugbankId']?.toString() ?? '')
      .map((v) => v.trim())
      .filter((v) => v !== ''),
  );
}
