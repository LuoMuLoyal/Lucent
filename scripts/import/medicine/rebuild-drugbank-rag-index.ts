#!/usr/bin/env node

/**
 * Rebuilds the DrugBank RAG passage index.
 *
 * Two-phase architecture:
 *   1. --rebuild (default): chunk narrative fields from drugbank_drugs → write drugbank_passage_chunks
 *   2. --embed:            load chunks → PGVectorStore.addDocuments() → drugbank_passage_embeddings
 *
 * Use --limit for smoke tests; it does not trigger a full import.
 */

import { Client } from 'pg';

import { loadEnvironment } from '../../shared/env.ts';
import { stableUuid } from '../../shared/stable-id.ts';
import {
  chunkText,
  normalizeValue,
  computeSourceHash,
  insertChunksBatch,
  createEmbeddingStore,
  embedDocuments,
  parseRebuildArgs,
} from '../../shared/chunking.ts';

const CHUNK_TABLE = 'drugbank_passage_chunks';
const EMBEDDING_TABLE = 'drugbank_passage_embeddings';

const CHUNKABLE_FIELDS = [
  'description',
  'indication',
  'mechanism_of_action',
  'pharmacodynamics',
  'toxicity',
  'metabolism',
  'absorption',
  'half_life',
  'clearance',
];

const CHUNK_COLUMNS = [
  'id',
  'drugbank_id',
  'source_field',
  'chunk_text',
  'chunk_index',
  'source_version',
  'source_hash',
];

// ─── Data loading ─────────────────────────────────────────────

async function loadDrugbankRows(client, sourceLimit) {
  if (sourceLimit != null) {
    const result = await client.query(
      `
        SELECT
          drugbank_id,
          name,
          description,
          indication,
          mechanism_of_action,
          pharmacodynamics,
          toxicity,
          metabolism,
          absorption,
          half_life,
          clearance,
          updated_at
        FROM drugbank_drugs
        ORDER BY name ASC
        LIMIT $1
      `,
      [sourceLimit],
    );
    return result.rows;
  }

  const result = await client.query(`
    SELECT
      drugbank_id,
      name,
      description,
      indication,
      mechanism_of_action,
      pharmacodynamics,
      toxicity,
      metabolism,
      absorption,
      half_life,
      clearance,
      updated_at
    FROM drugbank_drugs
    ORDER BY name ASC
  `);
  return result.rows;
}

// ─── Chunk building ───────────────────────────────────────────

function buildChunkId(drugbankId, field, index, sourceHash) {
  return stableUuid(
    'drugbank_passage_chunk',
    drugbankId,
    field,
    String(index),
    sourceHash,
  );
}

function buildChunks(rows, options) {
  const sourceHash = computeSourceHash(rows, 'drugbank_id', 'updated_at');
  const sourceVersion =
    options.sourceVersion ?? `rebuilt-${new Date().toISOString()}`;
  const chunks = [];

  for (const row of rows) {
    for (const field of CHUNKABLE_FIELDS) {
      const text = normalizeValue(row[field]);
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
          id: buildChunkId(row.drugbank_id, field, index, sourceHash),
          drugbank_id: row.drugbank_id,
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
  console.log('Loading DrugBank rows...');
  const rows = await loadDrugbankRows(client, options.sourceLimit);
  console.log(`Loaded ${rows.length} rows`);

  const chunks = buildChunks(rows, options);
  console.log(`Prepared ${chunks.length} chunks`);

  if (options.dryRun) {
    console.log('Dry run: no database writes');
    return {
      drugCount: rows.length,
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
    ['drugbank_id', 'source_field', 'chunk_index'],
    ['chunk_text', 'source_version', 'source_hash'],
    chunks,
  );
  console.log(`Inserted ${inserted} chunks`);

  return { drugCount: rows.length, chunkCount: chunks.length, inserted };
}

// ─── Embedding phase ──────────────────────────────────────────

async function embedChunks(client, options) {
  const embeddingStore = await createEmbeddingStore(EMBEDDING_TABLE);
  if (!embeddingStore) {
    return { embedded: 0 };
  }
  const { store, pool } = embeddingStore;

  try {
    if (options.embedForce) {
      console.log('Clearing existing embeddings (--embed-force)...');
      await pool.query(`DELETE FROM "${EMBEDDING_TABLE}"`);
    }

    // Load all chunks from drugbank_passage_chunks
    let allChunks;
    if (options.embedLimit != null) {
      allChunks = (
        await client.query(
          `
            SELECT id, drugbank_id, source_field, chunk_text, chunk_index
            FROM "${CHUNK_TABLE}"
            ORDER BY updated_at DESC, id ASC
            LIMIT $1
          `,
          [options.embedLimit],
        )
      ).rows;
    } else {
      allChunks = (
        await client.query(`
          SELECT id, drugbank_id, source_field, chunk_text, chunk_index
          FROM "${CHUNK_TABLE}"
          ORDER BY updated_at DESC, id ASC
        `)
      ).rows;
    }

    if (allChunks.length === 0) {
      console.log(`No chunks found in ${CHUNK_TABLE}.`);
      return { embedded: 0 };
    }

    // Load drug names for metadata enrichment
    const drugResult = await client.query(
      'SELECT drugbank_id, name FROM drugbank_drugs',
    );
    const drugNames = new Map();
    for (const row of drugResult.rows) {
      drugNames.set(row.drugbank_id, row.name);
    }

    // Build Document array
    const docs = allChunks.map((row) => ({
      pageContent: row.chunk_text,
      metadata: {
        chunkId: row.id,
        drugbankId: row.drugbank_id,
        drugName: drugNames.get(row.drugbank_id) ?? null,
        field: row.source_field,
        chunkIndex: row.chunk_index,
      },
    }));

    const embedded = await embedDocuments(store, docs, options.embedBatchSize);
    return { embedded };
  } finally {
    await pool.end();
  }
}

// ─── CLI ──────────────────────────────────────────────────────

function printHelp() {
  console.log(`
Usage: node rebuild-drugbank-rag-index.ts [options]

Options:
  --max-chunk-length <n>  Max chunk length (default: 1000)
  --chunk-overlap <n>     Chunk overlap (default: 100)
  --source-version <v>    Version tag for the rebuild
  --limit <n>             Max source rows to process (default: all)
  --dry-run               Count chunks without writing
  --skip-rebuild          Skip chunk rebuild and only embed
  --embed                 Run embedding phase
  --embed-limit <n>       Max chunks to embed (default: all)
  --embed-batch-size <n>  Batch size for embedding (default: 20)
  --embed-force           Clear existing embeddings before re-embedding
  --help, -h              Show this help

Examples:
  node rebuild-drugbank-rag-index.ts --limit 100 --embed --embed-limit 100
  node rebuild-drugbank-rag-index.ts --dry-run --limit 100
  node rebuild-drugbank-rag-index.ts --skip-rebuild --embed --embed-limit 100
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
    if (!options.skipRebuild) {
      const summary = await rebuild(client, options);
      console.log(JSON.stringify({ ...summary, options }, null, 2));
    } else {
      console.log(JSON.stringify({ skippedRebuild: true, options }, null, 2));
    }

    if (options.embed) {
      const embedSummary = await embedChunks(client, options);
      console.log(JSON.stringify({ ...embedSummary }, null, 2));
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
