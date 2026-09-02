#!/usr/bin/env node

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

const CHUNK_TABLE = 'medicine_leaflet_chunks';
const EMBEDDING_TABLE = 'leaflet_embeddings';

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

    // Load all chunks from medicine_leaflet_chunks
    let allChunks;
    if (options.embedLimit != null) {
      allChunks = (
        await client.query(
          `
            SELECT mc.id, mc.leaflet_id, mc.source_field, mc.chunk_text, mc.chunk_index
            FROM "${CHUNK_TABLE}" mc
            ORDER BY mc.updated_at DESC, mc.id ASC
            LIMIT $1
          `,
          [options.embedLimit],
        )
      ).rows;
    } else {
      allChunks = (
        await client.query(`
          SELECT mc.id, mc.leaflet_id, mc.source_field, mc.chunk_text, mc.chunk_index
          FROM "${CHUNK_TABLE}" mc
          ORDER BY mc.updated_at DESC, mc.id ASC
        `)
      ).rows;
    }

    if (allChunks.length === 0) {
      console.log(`No chunks found in ${CHUNK_TABLE}.`);
      return { embedded: 0 };
    }

    // Load leaflet-to-product mappings for metadata enrichment
    const linkResult = await client.query(`
      SELECT l.leaflet_id, l.product_id, p.name
      FROM cn_medicine_product_leaflet_links l
      LEFT JOIN cn_medicine_products p ON p.id = l.product_id
    `);
    const leafletProducts = new Map();
    const leafletProductNames = new Map();
    for (const row of linkResult.rows) {
      const ids = leafletProducts.get(row.leaflet_id) ?? [];
      ids.push(row.product_id);
      leafletProducts.set(row.leaflet_id, ids);

      const names = leafletProductNames.get(row.leaflet_id) ?? [];
      if (row.name != null) {
        names.push(row.name);
      }
      leafletProductNames.set(row.leaflet_id, names);
    }

    // Build Document array
    const docs = allChunks.map((row) => ({
      pageContent: row.chunk_text,
      metadata: {
        leafletId: row.leaflet_id,
        sourceField: row.source_field,
        chunkIndex: row.chunk_index,
        chunkId: row.id,
        productIds: leafletProducts.get(row.leaflet_id) ?? [],
        productNames: leafletProductNames.get(row.leaflet_id) ?? [],
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
Usage: node rebuild-leaflet-index.ts [options]

Options:
  --max-chunk-length <n>  Max chunk length (default: 1000)
  --chunk-overlap <n>     Chunk overlap (default: 100)
  --source-version <v>    Version tag for the rebuild
  --source-limit <n>      Max source rows to process (default: all)
  --dry-run               Count chunks without writing
  --skip-rebuild          Skip chunk rebuild and only embed
  --embed                 Run embedding phase
  --embed-limit <n>       Max chunks to embed (default: all)
  --embed-batch-size <n>  Batch size for embedding (default: 20)
  --embed-force           Clear existing embeddings before re-embedding
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
