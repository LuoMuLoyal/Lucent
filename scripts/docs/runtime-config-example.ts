// Structural check for the runtime-config document template.
//
// The template at `docs/reference/runtime-config.example.txt` is the operator's
// copy-paste source and the human-facing whitelist. Two things must hold or the
// template silently drifts from the code:
//   1. every key the schema accepts appears exactly once (and nothing else);
//   2. the whole file parses under the current document schema.
// Values and comments are not compared — comments are reviewed by humans.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createJiti } from 'jiti';

export const RUNTIME_CONFIG_EXAMPLE_PATH =
  'docs/reference/runtime-config.example.txt';

interface RuntimeConfigSchemaLike {
  RUNTIME_CONFIG_KEYS: readonly string[];
  RUNTIME_CONFIG_SCHEMA_VERSION_KEY: string;
  RUNTIME_CONFIG_REVISION_KEY: string;
  parseRuntimeConfigDocument: (raw: string) =>
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly reason: string;
        readonly message: string;
      };
}

/**
 * Compares the keys declared in a document against the expected set.
 *
 * Returns human-readable problems; empty means the key sets match exactly.
 */
export function diffRuntimeConfigExampleKeys(
  raw: string,
  expectedKeys: readonly string[],
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  let lineNumber = 0;

  for (const line of raw.split(/\r?\n/u)) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  }

  const expected = new Set(expectedKeys);
  const missing = [...expected].filter((key) => !seen.has(key)).sort();
  const unexpected = [...seen].filter((key) => !expected.has(key)).sort();

  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(
      `${RUNTIME_CONFIG_EXAMPLE_PATH}: missing keys from the schema: ${missing.join(', ')}`,
    );
  }
  if (unexpected.length > 0) {
    problems.push(
      `${RUNTIME_CONFIG_EXAMPLE_PATH}: keys not accepted by the schema: ${unexpected.sort().join(', ')}`,
    );
  }
  if (duplicates.size > 0) {
    problems.push(
      `${RUNTIME_CONFIG_EXAMPLE_PATH}: duplicate keys: ${[...duplicates].sort().join(', ')}`,
    );
  }
  return problems;
}

/**
 * Runs both checks against the working tree. The schema is loaded through
 * jiti because the docs scripts run on plain Node while the schema lives in
 * TypeScript with `.js` import specifiers.
 */
export async function collectRuntimeConfigExampleProblems(
  repoRoot: string,
): Promise<string[]> {
  const path = join(repoRoot, RUNTIME_CONFIG_EXAMPLE_PATH);
  if (!existsSync(path)) {
    return [`${RUNTIME_CONFIG_EXAMPLE_PATH}: file is missing`];
  }
  const raw = readFileSync(path, 'utf8');

  const jiti = createJiti(import.meta.url);
  const schema = await jiti.import<RuntimeConfigSchemaLike>(
    join(repoRoot, 'src/config/runtime/runtime-config.schema.ts'),
  );
  const expectedKeys = [
    ...schema.RUNTIME_CONFIG_KEYS,
    schema.RUNTIME_CONFIG_SCHEMA_VERSION_KEY,
    schema.RUNTIME_CONFIG_REVISION_KEY,
  ];

  const problems = diffRuntimeConfigExampleKeys(raw, expectedKeys);
  const parsed = schema.parseRuntimeConfigDocument(raw);
  if (parsed.ok === false) {
    problems.push(
      `${RUNTIME_CONFIG_EXAMPLE_PATH}: rejected by the document schema (${parsed.reason}): ${parsed.message}`,
    );
  }
  return problems;
}
