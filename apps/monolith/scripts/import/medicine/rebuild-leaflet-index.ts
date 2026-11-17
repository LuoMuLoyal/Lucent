#!/usr/bin/env node

import { Client } from 'pg';

import { loadEnvironment } from '../../shared/env.ts';
import { stableUuid } from '../../shared/stable-id.ts';
import {
  chunkText,
  normalizeValue,
  computeSourceHash,
  insertChunksBatch,
  parseRebuildArgs,
} from '../../shared/chunking.ts';

const CHUNK_TABLE = 'medicine_leaflet_chunks';

const CHUNKABLE_FIELDS = [
  'indications',
  'dosage',
  'contraindications',
  'precautions',
  'adverse_reactions',
  'drug_interactions',
  'pharmacology_toxicology',
  'pharmacokinetics',
  'storage',
  'validity_period',
];

const CHUNK_COLUMNS = [
  'id',
  'source_kind',
  'leaflet_id',
  'source_field',
  'chunk_text',
  'chunk_index',
  'source_version',
  'source_hash',
];

// ─── Data loading ─────────────────────────────────────────────

async function loadLeaflets(client, sourceLimit) {
  if (sourceLimit != null) {
    const result = await client.query(
      `
        SELECT
          "id",
          "instruction_id",
          "indications",
          "dosage",
          "contraindications",
          "precautions",
          "adverse_reactions",
          "drug_interactions",
          "pharmacology_toxicology",
          "pharmacokinetics",
          "storage",
          "validity_period",
          "updated_at"
        FROM "cn_medicine_leaflets"
        ORDER BY "updated_at" DESC, "id" ASC
        LIMIT $1
      `,
      [sourceLimit],
    );
    return result.rows;
  }

  const result = await client.query(`
    SELECT
      "id",
      "instruction_id",
      "indications",
      "dosage",
      "contraindications",
      "precautions",
      "adverse_reactions",
      "drug_interactions",
      "pharmacology_toxicology",
      "pharmacokinetics",
      "storage",
      "validity_period",
      "updated_at"
    FROM "cn_medicine_leaflets"
    ORDER BY "updated_at" DESC, "id" ASC
  `);
  return result.rows;
}

// ─── Chunk building ───────────────────────────────────────────

function buildChunkId(leafletId, field, index, sourceHash) {
  return stableUuid(
    'medicine_leaflet_chunk',
    leafletId,
    field,
    String(index),
    sourceHash,
  );
}

function buildChunks(leaflets, options) {
  const sourceHash = computeSourceHash(leaflets, 'id', 'updated_at');
  const sourceVersion =
    options.sourceVersion ?? `rebuilt-${new Date().toISOString()}`;
  const chunks = [];

  for (const leaflet of leaflets) {
    for (const field of CHUNKABLE_FIELDS) {
      const text = normalizeValue(leaflet[field]);
      if (!text || text.trim().length === 0) {
        continue;
      }

      const fieldChunks = chunkText(
        text,
        options.maxChunkLength,
        options.chunkOverlap,
      );
      for (let index = 0; index < fieldChunks.length; index += 1) {
        chunks.push({
          id: buildChunkId(leaflet.id, field, index, sourceHash),
          source_kind: 'cn',
          leaflet_id: leaflet.id,
          source_field: field,
          chunk_text: fieldChunks[index],
          chunk_index: index,
          source_version: sourceVersion,
          source_hash: sourceHash,
        });
      }
    }
  }

  return chunks;
}

// ─── Rebuild phase ────────────────────────────────────────────

async function rebuild(client, options) {
  console.log('Loading leaflets...');
  const leaflets = await loadLeaflets(client, options.sourceLimit);
  console.log(`Loaded ${leaflets.length} leaflets`);

  const chunks = buildChunks(leaflets, options);
  console.log(`Prepared ${chunks.length} chunks`);

  if (options.dryRun) {
    console.log('Dry run: no database writes');
    return {
      leafletCount: leaflets.length,
      chunkCount: chunks.length,
      inserted: 0,
    };
  }

  console.log('Clearing existing chunks...');
  const deletedCount = (await client.query(`DELETE FROM "${CHUNK_TABLE}"`))
    .rowCount;
  console.log(`Deleted ${deletedCount} existing chunks`);

  console.log('Inserting chunks...');
  const inserted = await insertChunksBatch(
    client,
    CHUNK_TABLE,
    CHUNK_COLUMNS,
    ['leaflet_id', 'source_field', 'chunk_index'],
    ['source_kind', 'chunk_text', 'source_version', 'source_hash'],
    chunks,
  );
  console.log(`Inserted ${inserted} chunks`);

  return { leafletCount: leaflets.length, chunkCount: chunks.length, inserted };
}

// ─── CLI ──────────────────────────────────────────────────────

function printHelp() {
  console.log(`
Usage: node rebuild-leaflet-index.ts [options]

Options:
  --max-chunk-length <n>  Max chunk length (default: 1000)
  --chunk-overlap <n>     Chunk overlap (default: 100)
  --source-version <v>    Version tag for the rebuild
  --source-limit <n>      Max source rows to process (default: all)
  --dry-run               Count chunks without writing
  --help, -h              Show this help
`);
}

async function main() {
  loadEnvironment();

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured for the current NODE_ENV');
  }

  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const options = parseRebuildArgs(argv);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const summary = await rebuild(client, options);
    console.log(JSON.stringify({ ...summary, options }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
