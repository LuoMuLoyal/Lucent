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
  // Read straight from the environment on purpose: these specs exercise the
  // import scripts, which run as plain node/python outside the NestJS
  // container, so there is no ConfigService to inject here.
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
const DIRTY = new RegExp(
  [
    '&#\\d+;',
    '&lt;',
    '&gt;',
    '&amp;',
    '<sub>',
    '<sup>',
    // Reference markers and their leftovers. DrugBank writes them as
    // `[L6616]`, `[label,L6616]`, `[L45859,A4393]` and
    // `[FDA label, A31973, A31976]`; the last shape used to be unwrapped
    // rather than removed, leaving the bare text `FDA label, A31973, A31976`.
    '\\[[A-Z]{1,5}\\d{3,}',
    'label, *[A-Z]{1,5}\\d{3,}',
    '\\*\\*[^*\\s][^*]*\\*\\*',
  ].join('|'),
);

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

/**
 * Marker shapes taken verbatim from the corpus, plus prose that merely looks
 * like one. Runs the cleaner directly rather than through the parser, so it
 * covers shapes that a 400-record sample may not reach.
 */
const CLEANER_CASES: {
  readonly input: string;
  readonly keeps: string;
  readonly drops: readonly string[];
}[] = [
  // Real markers, including the shapes the first pattern missed.
  {
    input: 'immunodeficiency [FDA label, A31973, A31976].',
    keeps: 'immunodeficiency',
    drops: ['A31973', 'FDA label,'],
  },
  {
    input: 'receptors.[L45859,A4393] Aripiprazole',
    keeps: 'Aripiprazole',
    drops: ['L45859', 'A4393'],
  },
  {
    input: 'mania.[L45859] Aripiprazole',
    keeps: 'Aripiprazole',
    drops: ['L45859'],
  },
  {
    input: 'short duration of action [FDA label, F4471].',
    keeps: 'duration of action',
    drops: ['F4471'],
  },
  {
    input: '[label,L6616] Indicated',
    keeps: 'Indicated',
    drops: ['label,', 'L6616'],
  },
  // Multi-code marker with no label at all — the most common leftover shape.
  {
    input: 'cause cell death.[A264349, L51254] Denileukin',
    keeps: 'cause cell death. Denileukin',
    drops: ['A264349', 'L51254'],
  },
  // Short codes exist in the corpus.
  {
    input: 'antiseptics [L2745, L2744, L40069, F61] or as topical',
    keeps: 'or as topical',
    drops: ['L2745', 'F61'],
  },
  {
    input: 'esters [A15, A264344] were found',
    keeps: 'were found',
    drops: ['A15', 'A264344'],
  },
  // Unterminated: the source drops the closing bracket.
  {
    input: 'disorder.[L45859 An injectable formulation',
    keeps: 'An injectable formulation',
    drops: ['L45859'],
  },
  {
    input: 'L/h/kg [A19175. >99.5% bound to plasma proteins',
    keeps: '>99.5% bound to plasma proteins',
    drops: ['A19175'],
  },
  {
    input: '(5-FU). [A35289 However, this inhibitory effect',
    keeps: 'However, this inhibitory effect',
    drops: ['A35289'],
  },
  // Unterminated *and* last thing in the field — DB15067's metabolism ends here.
  {
    input: 'account for 55% of urinary recovery.[L16621',
    keeps: '55% of urinary recovery.',
    drops: ['L16621'],
  },
  // Prose that must survive untouched.
  { input: '[Homo sapiens] enzyme', keeps: 'Homo sapiens', drops: ['[', ']'] },
  {
    input: '[P450 enzymes] metabolise it',
    keeps: 'P450 enzymes',
    drops: ['[', ']'],
  },
  { input: 'dose of [100 mg] daily', keeps: '100 mg', drops: ['[', ']'] },
  {
    input: 'seen in [vitamin K] deficiency',
    keeps: 'vitamin K',
    drops: ['[', ']'],
  },
  {
    input: 'ATPase [Actin] activity',
    keeps: 'ATPase Actin',
    drops: ['[', ']'],
  },
];

describe('clean_narrative_text marker handling', () => {
  function clean(input: string): string {
    const stdout = execFileSync(
      'python',
      [
        '-c',
        [
          'import sys, json',
          `sys.path.insert(0, ${JSON.stringify(path.dirname(parserPath))})`,
          'from common import clean_narrative_text',
          'print(json.dumps(clean_narrative_text(sys.argv[1])))',
        ].join('\n'),
        input,
      ],
      { encoding: 'utf8' },
    );

    return JSON.parse(stdout.trim()) as string;
  }

  it.each(CLEANER_CASES)('cleans $input', ({ input, keeps, drops }) => {
    const output = clean(input);

    expect(output).toContain(keeps);
    for (const dropped of drops) {
      expect(output).not.toContain(dropped);
    }
  });
});
