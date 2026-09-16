import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Covers the `structures.sdf` parser that feeds `drugbank_structures`.
 *
 * The parser is a Python program, so the assertions run it as a subprocess over
 * the real dataset. That dataset is not available in CI, so the suite skips when
 * it is missing.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const parserPath = path.join(here, 'parsers', 'drugbank_structures.py');

const DATA_ROOT =
  process.env['MEDICINE_DATA_ROOT'] ??
  path.resolve(here, '..', '..', '..', '..', 'DrugDataBase');
const SDF_PATH = path.join(DATA_ROOT, 'unziped', 'structures.sdf');

interface StructureRecord {
  drugbank_id: string;
  smiles: string | null;
  inchi_key: string | null;
  formula: string | null;
  molecular_weight: number | null;
  jchem_logp: number | null;
  jchem_pka: number | null;
  jchem_acceptor_count: number | null;
  jchem_rule_of_five: number | null;
  salts: string[] | null;
}

const FLOAT_COLUMNS = [
  'molecular_weight',
  'exact_mass',
  'jchem_average_polarizability',
  'jchem_polar_surface_area',
  'jchem_refractivity',
  'jchem_logp',
  'jchem_pka',
  'jchem_pka_strongest_acidic',
  'jchem_pka_strongest_basic',
  'jchem_average_neutral_microspecies_charge',
  'alogps_logp',
  'alogps_logs',
] as const;

/** Parses the whole file once; the assertions below share the result. */
function parseAll(): { records: StructureRecord[]; raw: string } {
  const raw = execFileSync('python', [parserPath, '--source-path', SDF_PATH], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });

  const records = raw
    .split(/\r?\n/)
    .filter((line) => line.includes('"kind": "record"'))
    .map((line) => JSON.parse(line) as { data: StructureRecord })
    .map((envelope) => envelope.data);

  return { records, raw };
}

describe.skipIf(!existsSync(SDF_PATH))('drugbank structures SDF parser', () => {
  const { records, raw } = existsSync(SDF_PATH)
    ? parseAll()
    : { records: [] as StructureRecord[], raw: '' };

  it('emits every record with a DrugBank id', () => {
    expect(records.length).toBeGreaterThan(10000);
    expect(records.every((record) => /^DB\d+$/.test(record.drugbank_id))).toBe(
      true,
    );
  });

  it('has one record per drug, so no merge strategy is needed', () => {
    const ids = records.map((record) => record.drugbank_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the identity columns populated for every record', () => {
    for (const record of records) {
      expect(record.smiles).toBeTruthy();
      expect(record.inchi_key).toBeTruthy();
      expect(record.formula).toBeTruthy();
      expect(typeof record.molecular_weight).toBe('number');
    }
  });

  it('never emits a non-finite float', () => {
    // The source writes a literal `NaN` into a couple of pKa cells. Python's
    // json.dumps renders that as a bare `NaN` token, which no JSON reader
    // accepts — the importer died on it once already.
    expect(/(?<![\w"])NaN(?![\w"])/.test(raw)).toBe(false);
    expect(raw.includes('Infinity')).toBe(false);

    for (const record of records) {
      for (const column of FLOAT_COLUMNS) {
        const value = (record as unknown as Record<string, unknown>)[column];
        if (value === null || value === undefined) continue;
        expect(Number.isFinite(value as number)).toBe(true);
      }
    }
  });

  it('reads the well-known descriptors for a known drug', () => {
    const imatinib = records.find((record) => record.drugbank_id === 'DB00619');

    expect(imatinib).toBeDefined();
    expect(imatinib!.formula).toBe('C29H31N7O');
    expect(imatinib!.inchi_key).toBe('KTUFNOKKBVMGRW-UHFFFAOYSA-N');
    expect(imatinib!.molecular_weight).toBeCloseTo(493.6027, 3);
    expect(imatinib!.jchem_acceptor_count).toBe(7);
    expect(imatinib!.jchem_rule_of_five).toBe(1);
    expect(imatinib!.salts).toEqual(['Imatinib mesylate']);
  });

  it('leaves out the upstream-broken traditional IUPAC name', () => {
    // It reports a different compound for most drugs (aspirin reads as a
    // dexamethasone salt), so it must not reach the table at all.
    expect(raw).not.toContain('jchem_traditional_iupac');
    expect(raw).not.toContain('tetrahydrofolic acid');
  });

  it('does not re-import the lists the XML already provides', () => {
    for (const column of ['synonyms', 'products', 'drug_groups']) {
      expect(raw).not.toContain(`"${column}"`);
    }
  });
});
