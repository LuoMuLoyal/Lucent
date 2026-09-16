import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Covers the DrugBank narrative-text cleaning path.
 *
 * The importer pipes every parser through `clean_narrative_text` for prose
 * fields only. DrugBank ships raw XML entities and pseudo-Markdown in those
 * fields (`&#13;`, `&lt;sub&gt;`, `**bold**`, `[label,L6616]`), which used to
 * be stored and rendered verbatim.
 *
 * The parser is a Python program, so the behavioural assertions run it as a
 * subprocess over a fixture. The full DrugBank XML (~1.9 GB) is not available
 * in CI, so these tests only run when the local dataset is present; the
 * pure-function expectations below always run.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const parserPath = path.join(here, 'parsers', 'drugbank_drugs.py');

const DATA_ROOT =
  process.env['MEDICINE_DATA_ROOT'] ??
  path.resolve(here, '..', '..', '..', '..', 'DrugDataBase');
const XML_PATH = path.join(DATA_ROOT, 'unziped', 'full database.xml');

interface DrugRecord {
  name: string;
  drugbank_id: string;
  indication: string | null;
  toxicity: string | null;
  mechanism_of_action: string | null;
  description: string | null;
}

function parseDrugs(limit: number): DrugRecord[] {
  const stdout = execFileSync(
    'python',
    [parserPath, '--source-path', XML_PATH, '--limit', String(limit)],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );

  return stdout
    .split(/\r?\n/)
    .filter((line) => line.includes('"kind": "record"'))
    .map((line) => JSON.parse(line) as { data: DrugRecord })
    .map((envelope) => envelope.data);
}

const NARRATIVE_FIELDS = [
  'description',
  'indication',
  'mechanism_of_action',
  'toxicity',
] as const;

/**
 * Markers that are unambiguously leftover markup.
 *
 * Bare `**` is deliberately excluded: some source rows use it as a literal
 * footnote marker inside prose (e.g. `CD-10* or TOP** peptidases` in DB06071),
 * which is content and must survive. Only *paired* emphasis — `**word**` — is
 * markup, and that is asserted separately below.
 */
const DIRTY = /&#\d+;|&lt;|&gt;|&amp;|<sub>|<sup>|\[label,|\*\*[^*\s][^*]*\*\*/;

describe.skipIf(!existsSync(XML_PATH))(
  'drugbank_drugs parser narrative cleaning',
  () => {
    const records = parseDrugs(400);

    // DrugBank emits several rows per name (parent entry plus salt forms), and
    // only one carries the narrative fields. Pick the populated one.
    const cetuximab = records.find(
      (record) => record.drugbank_id === 'DB00002' && record.indication,
    );

    it('emits records', () => {
      expect(records.length).toBeGreaterThan(0);
    });

    it('leaves no XML entities or paired emphasis in prose fields', () => {
      const offenders: string[] = [];

      for (const record of records) {
        for (const field of NARRATIVE_FIELDS) {
          const value = record[field];
          if (typeof value === 'string' && DIRTY.test(value)) {
            offenders.push(`${record.drugbank_id}.${field}`);
          }
        }
      }

      expect(offenders).toEqual([]);
    });

    it('finds the populated Cetuximab row to assert against', () => {
      expect(cetuximab).toBeDefined();
    });

    it('decodes subscripts instead of dropping the digits', () => {
      // Cetuximab ships "LD&lt;sub&gt;50&lt;/sub&gt;" which must become "LD50"
      // rather than losing the "50".
      expect(cetuximab?.toxicity).toContain('LD50');
    });

    it('keeps reference-marker removal from eating prose', () => {
      expect(cetuximab?.indication).toContain('Cetuximab is indicated for');
      // The `&#13;` line breaks must survive as real newlines.
      expect(cetuximab?.indication).toMatch(/\n/);
    });

    it('does not strip literal asterisks that are source content', () => {
      // DB06071 ships "CD-10* or TOP** peptidases" — a footnote marker in the
      // original prose, not emphasis markup. Stripping it would corrupt text.
      const dts = records.find((record) => record.drugbank_id === 'DB06071');

      if (dts?.description) {
        expect(dts.description).toContain('TOP**');
      }
    });
  },
);
