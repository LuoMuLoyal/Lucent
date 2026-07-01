#!/usr/bin/env node

const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('pg');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

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

function loadEnvironment() {
  const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
  dotenv.config({
    path: path.join(REPO_ROOT, `.env.${nodeEnv}.local`),
    override: true,
  });
  dotenv.config({
    path: path.join(REPO_ROOT, `.env.${nodeEnv}`),
    override: true,
  });
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    limit: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (part === '--limit') {
      options.limit = Number(argv[index + 1]) || null;
      index += 1;
    }
  }

  return options;
}

async function loadDrugbankRows(client, limit) {
  const limitClause = limit != null ? `LIMIT ${limit}` : '';
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
      clearance
    FROM drugbank_drugs
    ORDER BY name ASC
    ${limitClause}
  `);
  return result.rows;
}

async function main() {
  loadEnvironment();

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }

  const options = parseArgs(process.argv.slice(2));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const rows = await loadDrugbankRows(client, options.limit);
    let passageCount = 0;

    for (const row of rows) {
      for (const field of CHUNKABLE_FIELDS) {
        if (row[field] != null && String(row[field]).trim().length > 0) {
          passageCount += 1;
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          sourceRows: rows.length,
          chunkCount: passageCount,
          embedded: 0,
          skipped: 0,
          dryRun: options.dryRun,
          fields: CHUNKABLE_FIELDS,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
