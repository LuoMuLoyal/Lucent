import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Covers the two FASTA parsers that feed `drugbank_target_sequences` and
 * `drugbank_drug_sequences`.
 *
 * The parsers are Python programs, so the behavioural assertions run them as
 * subprocesses over the real datasets. Those datasets are not available in CI,
 * so the suite skips when they are missing; the header-splitting expectations
 * below are pure and always run.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const targetParser = path.join(here, 'parsers', 'drugbank_target_sequences.py');
const drugParser = path.join(here, 'parsers', 'drugbank_drug_sequences.py');

const DATA_ROOT =
  process.env['MEDICINE_DATA_ROOT'] ??
  path.resolve(here, '..', '..', '..', '..', 'DrugDataBase');
const UNZIPPED = path.join(DATA_ROOT, 'unziped');
const PROTEIN_FASTA = path.join(UNZIPPED, 'protein.fasta');
const GENE_FASTA = path.join(UNZIPPED, 'gene.fasta');
const DRUG_FASTA = path.join(UNZIPPED, 'drug sequences.fasta');

interface TargetSequenceRecord {
  id: string;
  source_dataset: string;
  uniprot_id: string;
  target_name: string | null;
  drugbank_ids: string[] | null;
  sequence: string;
  length: number;
}

interface DrugSequenceRecord {
  id: string;
  drugbank_id: string;
  description: string;
  sequence: string;
  length: number;
}

function runParser<T>(parser: string, args: string[], limit: number): T[] {
  const stdout = execFileSync(
    'python',
    [
      parser,
      '--source-path',
      args[0]!,
      '--limit',
      String(limit),
      ...args.slice(1),
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );

  return stdout
    .split(/\r?\n/)
    .filter((line) => line.includes('"kind": "record"'))
    .map((line) => JSON.parse(line) as { data: T })
    .map((envelope) => envelope.data);
}

function parseTargets(file: string, dataset: string, limit: number) {
  return runParser<TargetSequenceRecord>(
    targetParser,
    [file, '--source-dataset', dataset],
    limit,
  );
}

function parseDrugs(limit: number) {
  return runParser<DrugSequenceRecord>(drugParser, [DRUG_FASTA], limit);
}

describe.skipIf(!existsSync(DRUG_FASTA))('drug sequence FASTA parser', () => {
  it('strips the header prefix from the id', () => {
    const [first] = parseDrugs(1);

    // Regression guard: the parser used to keep the leading `>` and the
    // `drugbank_drug|` prefix, yielding `>drugbank_drug|DB00001`.
    expect(first!.drugbank_id).toBe('DB00001');
    expect(first!.drugbank_id).not.toContain('|');
    expect(first!.drugbank_id).not.toContain('>');
  });

  it('keeps one row per chain rather than collapsing them', () => {
    // DB00002 is Cetuximab: a heavy and a light chain.
    const records = parseDrugs(3).filter(
      (record) => record.drugbank_id === 'DB00002',
    );

    expect(records).toHaveLength(2);
    expect(new Set(records.map((record) => record.description)).size).toBe(2);
  });

  it('reports the length that matches the sequence it stored', () => {
    for (const record of parseDrugs(5)) {
      expect(record.length).toBe(record.sequence.length);
      expect(record.sequence).not.toContain('\n');
    }
  });

  it('gives every row a stable id derived from the natural key', () => {
    const first = parseDrugs(5);
    const second = parseDrugs(5);

    expect(first.map((record) => record.id)).toEqual(
      second.map((record) => record.id),
    );
    expect(new Set(first.map((record) => record.id)).size).toBe(first.length);
  });
});

describe.skipIf(!existsSync(PROTEIN_FASTA))(
  'target sequence FASTA parser',
  () => {
    it('parses the UniProt id, name and drug list out of the header', () => {
      const [first] = parseTargets(PROTEIN_FASTA, 'protein_fasta', 1);

      expect(first!.uniprot_id).toBe('P45059');
      expect(first!.target_name).toBe('Peptidoglycan D,D-transpeptidase FtsI');
      expect(first!.drugbank_ids).toEqual(['DB00303']);
    });

    it('tags the row with the dataset it came from', () => {
      expect(
        parseTargets(PROTEIN_FASTA, 'protein_fasta', 1)[0]!.source_dataset,
      ).toBe('protein_fasta');
    });
  },
);

describe.skipIf(!existsSync(GENE_FASTA) || !existsSync(PROTEIN_FASTA))(
  'protein vs gene FASTA',
  () => {
    it('holds coding nucleotide sequence in gene.fasta, not a copy of protein', () => {
      // Both files share a header format, so the only thing keeping them apart
      // is `source_dataset`. These two are the same target (P45059).
      const [protein] = parseTargets(PROTEIN_FASTA, 'protein_fasta', 1);
      const [gene] = parseTargets(GENE_FASTA, 'gene_fasta', 1);

      expect(gene!.uniprot_id).toBe(protein!.uniprot_id);
      expect(gene!.sequence).not.toBe(protein!.sequence);

      // Amino-acid alphabet vs the four nucleotides.
      expect(new Set(protein!.sequence).size).toBeGreaterThan(10);
      expect([...new Set(gene!.sequence)].sort().join('')).toBe('ACGT');
    });

    it('keeps gene length at three bases per residue plus a stop codon', () => {
      const [protein] = parseTargets(PROTEIN_FASTA, 'protein_fasta', 5);
      const [gene] = parseTargets(GENE_FASTA, 'gene_fasta', 5);

      expect(gene!.length).toBe(protein!.length * 3 + 3);
    });
  },
);
