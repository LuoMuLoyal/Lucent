#!/usr/bin/env node

/**
 * Imports the alpaca_zh_demo.json medical Q&A dataset (~1.36M records, ~1.83 GB)
 * into the RAG pipeline.
 *
 * Two-phase architecture:
 *   1. --filter: stream-parse NDJSON → safety filter → write medical_qa_chunks
 *   2. --embed:  load chunks → PGVectorStore.addDocuments() → medical_qa_embeddings
 *
 * Prerequisite: convert the JSON array to NDJSON first:
 *   python -c "import json; data=json.load(open('alpaca_zh_demo.json')); [print(json.dumps(r,ensure_ascii=False)) for r in data]" > medical_qa.ndjson
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { loadEnvironment } from '../../shared/env.ts';
import { createEmbeddingStore, embedDocuments } from '../../shared/chunking.ts';

// ESM equivalent of __dirname (scripts/ is a "type": "module" package).
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(thisDir, '..', '..', '..');
const DRUG_DATA_ROOT = path.resolve(REPO_ROOT, '..', 'DrugDataBase');
const DEFAULT_SOURCE_PATH = path.join(
  DRUG_DATA_ROOT,
  '医疗问答数据集一共135万条',
  '数据集',
  'medical_qa.ndjson',
);

const FILTER_BATCH_SIZE = 500;
const MIN_ANSWER_LENGTH = 50;

// ── Safety filter ─────────────────────────────────────────────
const BLOCKED_KEYWORDS = [
  '处方',
  '药方',
  '剂量mg',
  '剂量g',
  '手术步骤',
  '注射剂量',
  '偏方',
  '祖传秘方',
  '自行用药',
  '自行配药',
];

const CAUTION_KEYWORDS = [
  '诊断',
  '确诊',
  '鉴别诊断',
  '治疗方案',
  '首选药物',
  '推荐用药',
  '遵医嘱',
  '请咨询医生',
  '需就医',
  '应立即就医',
];

function classifySafety(
  instruction: string,
  output: string,
): 'safe' | 'caution' | 'blocked' {
  const combined = `${instruction} ${output}`;

  for (const kw of BLOCKED_KEYWORDS) {
    if (combined.includes(kw)) return 'blocked';
  }

  for (const kw of CAUTION_KEYWORDS) {
    if (combined.includes(kw)) return 'caution';
  }

  return 'safe';
}

// ── Environment ────────────────────────────────────────────────

// ── Phase 1: filter & write chunks ─────────────────────────────

interface QaRecord {
  id: string;
  instruction: string;
  output: string;
}

async function filterAndWrite(options: {
  sourcePath: string;
  limit?: number;
  client: Client;
}): Promise<{
  total: number;
  safe: number;
  caution: number;
  blocked: number;
  written: number;
}> {
  const { sourcePath, limit, client } = options;

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  const stats: {
    total: number;
    safe: number;
    caution: number;
    blocked: number;
    written: number;
  } = {
    total: 0,
    safe: 0,
    caution: 0,
    blocked: 0,
    written: 0,
  };

  // Ensure table exists (idempotent; matches Prisma-managed schema)
  await client.query(`
    CREATE TABLE IF NOT EXISTS medical_qa_chunks (
      id TEXT PRIMARY KEY,
      qa_id TEXT NOT NULL UNIQUE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      safety_label TEXT NOT NULL CHECK (safety_label IN ('safe', 'caution', 'blocked')),
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Clear existing if re-importing
  const existingCount = await client.query(
    'SELECT count(*) FROM medical_qa_chunks',
  );
  if (Number(existingCount.rows[0].count) > 0) {
    console.log(`Clearing ${existingCount.rows[0].count} existing chunks...`);
    await client.query('DELETE FROM medical_qa_chunks');
  }

  const fileStream = fs.createReadStream(sourcePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let batch: QaRecord[] = [];

  async function flushBatch(): Promise<void> {
    if (batch.length === 0) return;

    const values: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const record of batch) {
      const label = classifySafety(record.instruction, record.output);
      stats[label] += 1;

      values.push(
        `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`,
      );
      params.push(
        crypto.randomUUID(),
        record.id,
        record.instruction,
        record.output,
        label,
      );
      idx += 5;
    }

    await client.query(
      `INSERT INTO medical_qa_chunks (id, qa_id, question, answer, safety_label)
       VALUES ${values.join(', ')}
       ON CONFLICT (qa_id) DO UPDATE SET
         question = EXCLUDED.question,
         answer = EXCLUDED.answer,
         safety_label = EXCLUDED.safety_label`,
      params,
    );

    stats.written += batch.length;
    batch = [];
  }

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const record: QaRecord = JSON.parse(trimmed);

      if (!record.id || !record.instruction || !record.output) continue;
      if ((record.output?.length ?? 0) < MIN_ANSWER_LENGTH) continue;

      batch.push(record);
      stats.total += 1;

      if (batch.length >= FILTER_BATCH_SIZE) {
        await flushBatch();
      }

      if (limit && stats.total >= limit) break;
    } catch {
      // Skip malformed lines
    }
  }

  await flushBatch();
  return stats;
}

// ── Phase 2: embed ─────────────────────────────────────────────

async function embedChunks(options: {
  client: Client;
  batchSize: number;
  force: boolean;
}): Promise<{ embedded: number }> {
  const embeddingStore = await createEmbeddingStore('medical_qa_embeddings');
  if (!embeddingStore) {
    return { embedded: 0 };
  }
  const { store, pool } = embeddingStore;

  try {
    if (options.force) {
      console.log('Clearing existing embeddings...');
      await pool.query('DELETE FROM medical_qa_embeddings');
    }

    // Load safe + caution chunks only (skip blocked)
    const result = await options.client.query(
      `SELECT qa_id, question, answer, safety_label FROM medical_qa_chunks WHERE safety_label != 'blocked'`,
    );
    const rows = result.rows;

    if (rows.length === 0) {
      console.log('No chunks to embed.');
      return { embedded: 0 };
    }

    const docs = rows.map((row: any) => ({
      pageContent: row.answer,
      metadata: {
        qaId: row.qa_id,
        question: row.question,
        safetyLabel: row.safety_label,
      },
    }));

    const embedded = await embedDocuments(store, docs, options.batchSize);
    return { embedded };
  } finally {
    await pool.end();
  }
}

// ── CLI ────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  sourcePath: string;
  limit?: number;
  filter: boolean;
  embed: boolean;
  embedBatchSize: number;
  embedForce: boolean;
  help: boolean;
} {
  const opts: ReturnType<typeof parseArgs> = {
    sourcePath: DEFAULT_SOURCE_PATH,
    filter: false,
    embed: false,
    embedBatchSize: 20,
    embedForce: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const part = argv[i];
    switch (part) {
      case '--source':
        opts.sourcePath = argv[++i] ?? DEFAULT_SOURCE_PATH;
        break;
      case '--limit':
        opts.limit = Number(argv[++i]) || undefined;
        break;
      case '--filter':
        opts.filter = true;
        break;
      case '--embed':
        opts.embed = true;
        break;
      case '--embed-batch-size':
        opts.embedBatchSize = Number(argv[++i]) || 20;
        break;
      case '--embed-force':
        opts.embedForce = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
Usage: node import-medical-qa.ts [options]

Options:
  --source <path>        NDJSON source file (default: DrugDataBase/医疗问答数据集一共135万条/数据集/medical_qa.ndjson)
  --limit <n>            Max records to import (default: all)
  --filter               Run Phase 1: parse NDJSON → safety filter → write medical_qa_chunks
  --embed                Run Phase 2: load chunks → generate embeddings → medical_qa_embeddings
  --embed-batch-size <n> Batch size for embedding (default: 20)
  --embed-force          Clear existing embeddings before re-embedding
  --help, -h             Show this help

Examples:
  node import-medical-qa.ts --filter --limit 10000
  node import-medical-qa.ts --embed --embed-force
  node import-medical-qa.ts --filter --embed
`);
}

async function main(): Promise<void> {
  loadEnvironment();

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }

  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || (!opts.filter && !opts.embed)) {
    printHelp();
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    if (opts.filter) {
      console.log('=== Phase 1: Filter & Import ===');
      const stats = await filterAndWrite({
        sourcePath: opts.sourcePath,
        limit: opts.limit,
        client,
      });
      console.log(JSON.stringify(stats, null, 2));
    }

    if (opts.embed) {
      console.log('=== Phase 2: Embed ===');
      const embedStats = await embedChunks({
        client,
        batchSize: opts.embedBatchSize,
        force: opts.embedForce,
      });
      console.log(JSON.stringify(embedStats, null, 2));
    }
  } finally {
    await client.end();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
