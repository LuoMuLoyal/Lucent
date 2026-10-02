import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { streamParseAndUpsert } from './db-upsert.ts';

/**
 * Pins the reader in `streamParseAndUpsert` against the remainder-batch loss.
 *
 * The defect this guards against: the reader used to be
 * `for await (const line of readline.createInterface(...))`, and the loop body
 * `await flushBatch()` pauses stdout consumption for as long as a batch takes
 * to write. Once the child had finished and exited, readline's internal state
 * raced its own `close` event and the loop threw `readline was closed`, so the
 * **final, short batch was never written** — while the run was still reported
 * as having finished.
 *
 * Measured on the real dataset: 63,889 link rows wrote exactly 63,800 (638 full
 * batches of 100) and dropped the trailing 89. The count is what makes this
 * reproducible: `rows % batchSize !== 0` is the precondition, so every case
 * below deliberately does not divide evenly.
 *
 * The parser is replaced by a stub Python program that emits NDJSON, so the
 * assertions exercise the real spawn/stream/flush path without needing
 * Postgres or the medicine datasets.
 */

const STUB_PARSER = `
import argparse, json, sys

parser = argparse.ArgumentParser()
parser.add_argument("--source-path", required=True)
parser.add_argument("--limit", type=int)
parser.add_argument("--source-dataset")
args = parser.parse_args()

# --source-path carries the row count the test wants, as "rows=<n>".
rows = int(args.source_path.split("=")[1])
if args.limit is not None:
    rows = min(rows, args.limit)

for index in range(rows):
    print(json.dumps({"kind": "record", "data": {"id": str(index)}}), flush=True)
`;

const temporaryDirectories: string[] = [];

function createStubParser(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'db-upsert-'));
  temporaryDirectories.push(directory);
  const parserPath = path.join(directory, 'stub_parser.py');
  writeFileSync(parserPath, STUB_PARSER, 'utf-8');
  return parserPath;
}

/** Runs the reader and reports what the flush callback actually received. */
async function readWithStub(rows: number, batchSize: number) {
  const parser = createStubParser();
  const flushed: number[] = [];
  let received = 0;

  const stats = await streamParseAndUpsert(
    { parser, columns: ['id'] },
    `rows=${String(rows)}`,
    { batchSize },
    async (batch: unknown[]) => {
      flushed.push(batch.length);
      received += batch.length;
    },
  );

  return { stats, flushed, received };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('streamParseAndUpsert reader', () => {
  it('writes the trailing short batch when the row count is not a multiple of batchSize', async () => {
    // 63,889 % 100 === 89 — the exact shape that silently lost 89 rows.
    const { received, flushed, stats } = await readWithStub(63_889, 100);

    expect(stats.rawRowCount).toBe(63_889);
    expect(received).toBe(63_889);
    // 638 full batches plus the remainder, not 638 alone.
    expect(flushed).toEqual([...Array<number>(638).fill(100), 89]);
  });

  it('reports rawRowCount even though the count is only assigned after the read returns', async () => {
    // The old failure left raw_row_count at 0 in `drug_source_imports`, which is
    // how a dropped remainder stayed invisible: the run looked complete.
    const { stats } = await readWithStub(250, 100);

    expect(stats.rawRowCount).toBe(250);
  });

  it('does not lose a row when the final line has no trailing newline', async () => {
    const { received, flushed } = await readWithStub(30, 100);

    expect(received).toBe(30);
    expect(flushed).toEqual([30]);
  });

  it('flushes nothing when the parser emits no rows', async () => {
    const { received, flushed, stats } = await readWithStub(0, 100);

    expect(stats.rawRowCount).toBe(0);
    expect(received).toBe(0);
    // The reader always calls flushBatch once at the end, even with an empty
    // batch; callers guard with `if (batch.length === 0) return`, so what
    // matters here is that no rows reached it.
    expect(flushed.every((size) => size === 0)).toBe(true);
  });

  it('honours batchSize independently of the row count', async () => {
    const { flushed, received } = await readWithStub(1_000, 256);

    expect(received).toBe(1_000);
    expect(flushed).toEqual([256, 256, 256, 232]);
  });
});
