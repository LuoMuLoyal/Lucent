#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const dotenv = require('dotenv');
const { Client } = require('pg');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_ROOT = path.resolve(REPO_ROOT, '..', 'DrugDataBase');
const STABLE_ID_NAMESPACE = 'lucent:medicine-import';
const MEDICINES_CACHE_KEY_PREFIX = 'medicines';

const COMMANDS = {
  'cn-products': {
    parser: path.join(__dirname, 'parsers', 'cn_products.py'),
    defaultSourcePath: path.join(DATA_ROOT, 'FullDrugDetail.xlsx'),
    sourceKey: 'cn_products',
    sourceName: 'full_drug_detail',
    tableName: 'cn_medicine_products',
    columns: [
      'id',
      'import_run_id',
      'source_name',
      'source_row_number',
      'name',
      'image_url',
      'price_text',
      'package_spec',
      'approval_number',
      'manufacturer',
      'drug_type',
      'main_category',
      'subcategory',
      'source_url',
      'brand_name',
      'ingredients',
      'properties',
      'indications',
      'dosage',
      'adverse_reactions',
      'contraindications',
      'precautions',
      'pediatric_use',
      'geriatric_use',
      'pregnancy_lactation',
      'pharmacology_toxicology',
      'drug_interactions',
      'pharmacokinetics',
      'overdose',
      'storage',
      'validity_period',
      'barcode',
      'national_drug_code',
      'search_text',
      'extras',
    ],
    conflictColumns: ['id'],
    updateColumns: [
      'import_run_id',
      'source_name',
      'source_row_number',
      'name',
      'image_url',
      'price_text',
      'package_spec',
      'approval_number',
      'manufacturer',
      'drug_type',
      'main_category',
      'subcategory',
      'source_url',
      'brand_name',
      'ingredients',
      'properties',
      'indications',
      'dosage',
      'adverse_reactions',
      'contraindications',
      'precautions',
      'pediatric_use',
      'geriatric_use',
      'pregnancy_lactation',
      'pharmacology_toxicology',
      'drug_interactions',
      'pharmacokinetics',
      'overdose',
      'storage',
      'validity_period',
      'barcode',
      'national_drug_code',
      'search_text',
      'extras',
    ],
  },
  'drugbank-drugs': {
    parser: path.join(__dirname, 'parsers', 'drugbank_drugs.py'),
    defaultSourcePath: path.join(DATA_ROOT, 'unziped', 'full database.xml'),
    sourceKey: 'drugbank_drugs',
    sourceName: 'drugbank_full_database_xml',
    tableName: 'drugbank_drugs',
    columns: [
      'drugbank_id',
      'import_run_id',
      'secondary_drugbank_ids',
      'drug_type',
      'source_created_at',
      'source_updated_at',
      'name',
      'description',
      'cas_number',
      'unii',
      'state',
      'groups',
      'indication',
      'pharmacodynamics',
      'mechanism_of_action',
      'toxicity',
      'metabolism',
      'absorption',
      'half_life',
      'protein_binding',
      'route_of_elimination',
      'volume_of_distribution',
      'clearance',
      'classification',
      'synonyms',
      'products',
      'international_brands',
      'categories',
      'atc_codes',
      'food_interactions',
      'drug_interactions',
      'external_identifiers',
      'external_links',
      'search_text',
    ],
    conflictColumns: ['drugbank_id'],
    updateColumns: [
      'import_run_id',
      'secondary_drugbank_ids',
      'drug_type',
      'source_created_at',
      'source_updated_at',
      'name',
      'description',
      'cas_number',
      'unii',
      'state',
      'groups',
      'indication',
      'pharmacodynamics',
      'mechanism_of_action',
      'toxicity',
      'metabolism',
      'absorption',
      'half_life',
      'protein_binding',
      'route_of_elimination',
      'volume_of_distribution',
      'clearance',
      'classification',
      'synonyms',
      'products',
      'international_brands',
      'categories',
      'atc_codes',
      'food_interactions',
      'drug_interactions',
      'external_identifiers',
      'external_links',
      'search_text',
    ],
  },
  'drugbank-links': {
    parser: path.join(__dirname, 'parsers', 'drugbank_external_links.py'),
    defaultSourcePath: path.join(DATA_ROOT, 'unziped', 'drug links.csv'),
    sourceKey: 'drugbank_external_links',
    sourceName: 'drugbank_drug_links_csv',
    tableName: 'drugbank_external_links',
    columns: [
      'id',
      'import_run_id',
      'drugbank_id',
      'drug_name',
      'cas_number',
      'drug_type',
      'kegg_compound_id',
      'kegg_drug_id',
      'pubchem_compound_id',
      'pubchem_substance_id',
      'chebi_id',
      'pharmgkb_id',
      'het_id',
      'uniprot_id',
      'uniprot_title',
      'genbank_id',
      'dpd_id',
      'rxlist_link',
      'pdrhealth_link',
      'wikipedia_id',
      'drugs_com_link',
      'ndc_id',
    ],
    conflictColumns: ['id'],
    updateColumns: [
      'import_run_id',
      'drugbank_id',
      'drug_name',
      'cas_number',
      'drug_type',
      'kegg_compound_id',
      'kegg_drug_id',
      'pubchem_compound_id',
      'pubchem_substance_id',
      'chebi_id',
      'pharmgkb_id',
      'het_id',
      'uniprot_id',
      'uniprot_title',
      'genbank_id',
      'dpd_id',
      'rxlist_link',
      'pdrhealth_link',
      'wikipedia_id',
      'drugs_com_link',
      'ndc_id',
    ],
  },
  'drugbank-targets-all': {
    parser: path.join(__dirname, 'parsers', 'drugbank_targets.py'),
    defaultSourcePath: path.join(DATA_ROOT, 'unziped', 'all.csv'),
    sourceKey: 'drugbank_targets_all',
    sourceName: 'drugbank_all_targets_csv',
    sourceDataset: 'all',
    mode: 'targets',
    tableName: 'drugbank_targets',
    columns: [
      'id',
      'import_run_id',
      'source_dataset',
      'source_target_id',
      'name',
      'gene_name',
      'genbank_protein_id',
      'genbank_gene_id',
      'uniprot_id',
      'uniprot_title',
      'pdb_ids',
      'gene_card_id',
      'gen_atlas_id',
      'hgnc_id',
      'species',
    ],
    conflictColumns: ['source_dataset', 'source_target_id'],
    updateColumns: [
      'import_run_id',
      'name',
      'gene_name',
      'genbank_protein_id',
      'genbank_gene_id',
      'uniprot_id',
      'uniprot_title',
      'pdb_ids',
      'gene_card_id',
      'gen_atlas_id',
      'hgnc_id',
      'species',
    ],
  },
  'drugbank-targets-active': {
    parser: path.join(__dirname, 'parsers', 'drugbank_targets.py'),
    defaultSourcePath: path.join(
      DATA_ROOT,
      'unziped',
      'pharmacologically_active.csv',
    ),
    sourceKey: 'drugbank_targets_pharmacologically_active',
    sourceName: 'drugbank_pharmacologically_active_targets_csv',
    sourceDataset: 'pharmacologically_active',
    mode: 'targets',
    tableName: 'drugbank_targets',
    columns: [
      'id',
      'import_run_id',
      'source_dataset',
      'source_target_id',
      'name',
      'gene_name',
      'genbank_protein_id',
      'genbank_gene_id',
      'uniprot_id',
      'uniprot_title',
      'pdb_ids',
      'gene_card_id',
      'gen_atlas_id',
      'hgnc_id',
      'species',
    ],
    conflictColumns: ['source_dataset', 'source_target_id'],
    updateColumns: [
      'import_run_id',
      'name',
      'gene_name',
      'genbank_protein_id',
      'genbank_gene_id',
      'uniprot_id',
      'uniprot_title',
      'pdb_ids',
      'gene_card_id',
      'gen_atlas_id',
      'hgnc_id',
      'species',
    ],
  },
};

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
  dotenv.config({ path: path.join(REPO_ROOT, '.env') });

  return nodeEnv;
}

function parseArgs(argv) {
  const args = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith('--')) {
      args._.push(part);
      continue;
    }

    const key = part.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
}

async function redisStoreFromUrl(redisUrl) {
  const { redisStore } = require('cache-manager-ioredis-yet');
  const url = new URL(redisUrl);

  return redisStore({
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    db: url.pathname ? Number(url.pathname.slice(1)) || 0 : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  });
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function stripNamespacePrefix(key, namespacePrefix) {
  if (!namespacePrefix || !key.startsWith(namespacePrefix)) {
    return key;
  }

  return key.slice(namespacePrefix.length);
}

async function listMedicineCacheKeys(store, namespace = 'keyv') {
  const namespacePrefix = namespace ? `${namespace}:` : null;
  const patterns = namespacePrefix
    ? [`${namespacePrefix}${MEDICINES_CACHE_KEY_PREFIX}:*`, `${MEDICINES_CACHE_KEY_PREFIX}:*`]
    : [`${MEDICINES_CACHE_KEY_PREFIX}:*`];
  const matchedKeys = [];

  for (const pattern of patterns) {
    const keys = await store.keys(pattern);
    for (const key of keys) {
      const normalizedKey = stripNamespacePrefix(key, namespacePrefix);
      if (normalizedKey.startsWith(`${MEDICINES_CACHE_KEY_PREFIX}:`)) {
        matchedKeys.push(normalizedKey);
      }
    }
  }

  return uniqueStrings(matchedKeys);
}

async function invalidateMedicineCache() {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    return { invalidated: 0, skipped: 'REDIS_URL is not configured' };
  }

  const store = await redisStoreFromUrl(redisUrl);

  try {
    const keys = await listMedicineCacheKeys(store);
    if (keys.length === 0) {
      return { invalidated: 0 };
    }

    await Promise.all(keys.map((key) => store.del(key)));
    return { invalidated: keys.length };
  } finally {
    store.client.disconnect();
  }
}

function printUsage() {
  console.log(`Usage:
  node scripts/medicine/import-medicine-knowledge.js <command> [options]

Commands:
  cn-products
  drugbank-drugs
  drugbank-links
  drugbank-targets-all
  drugbank-targets-active

Options:
  --source <path>       Override the default source file path.
  --batch-size <n>      Number of records per upsert batch. Default: 100
  --limit <n>           Parse only the first N records (useful for smoke tests).
  --source-version <v>  Store the export/version string in drug_source_imports.
  --with-hash           Compute SHA-256 for the source file and store it in drug_source_imports.
`);
}

function normalizeValue(value) {
  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (value !== null && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return value;
}

function normalizeStableIdPart(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function formatUuid(buffer) {
  const hex = buffer.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function stableUuid(...parts) {
  const hash = crypto.createHash('sha1');
  hash.update(STABLE_ID_NAMESPACE);
  hash.update('::');
  hash.update(parts.map(normalizeStableIdPart).join('||'));

  const bytes = Buffer.from(hash.digest().subarray(0, 16));

  // Shape the first 16 digest bytes into a UUIDv5-compatible layout.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuid(bytes);
}

function parsePositiveIntegerOption(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return parsed;
}

function sqlIdentifier(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

function buildUpsertStatement(spec, rowCount) {
  const placeholders = [];
  const valuesPerRow = spec.columns.length;

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowPlaceholders = spec.columns.map((_, columnIndex) => {
      const parameterIndex = rowIndex * valuesPerRow + columnIndex + 1;
      return `$${String(parameterIndex)}`;
    });
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  }

  const updateAssignments = spec.updateColumns.map(
    (column) => `${sqlIdentifier(column)} = EXCLUDED.${sqlIdentifier(column)}`,
  );

  return `
    INSERT INTO ${sqlIdentifier(spec.tableName)} (${spec.columns
      .map(sqlIdentifier)
      .join(', ')})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (${spec.conflictColumns.map(sqlIdentifier).join(', ')})
    DO UPDATE SET
      ${updateAssignments.join(', ')},
      "updated_at" = CURRENT_TIMESTAMP
  `;
}

async function executeUpsert(client, spec, records) {
  if (records.length === 0) {
    return;
  }

  const sql = buildUpsertStatement(spec, records.length);
  const params = records.flatMap((record) =>
    spec.columns.map((column) => normalizeValue(record[column])),
  );

  await client.query(sql, params);
}

function collectRejectionSample(samples, rejection) {
  if (samples.length >= 10) {
    return;
  }

  samples.push({
    rowNumber: rejection.rowNumber ?? null,
    message: rejection.message,
  });
}

async function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function startImportRun(client, config, filePath, options) {
  const sourceStats = await fs.promises.stat(filePath);
  const importRunId = crypto.randomUUID();

  await client.query(
    `
      INSERT INTO "drug_source_imports" (
        "id",
        "source_key",
        "source_name",
        "source_version",
        "source_file_name",
        "source_file_hash",
        "source_exported_at",
        "status"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'running')
    `,
    [
      importRunId,
      config.sourceKey,
      config.sourceName,
      options.sourceVersion ?? null,
      path.basename(filePath),
      options.withHash ? await computeFileHash(filePath) : null,
      sourceStats.mtime.toISOString(),
    ],
  );

  return importRunId;
}

async function finishImportRun(client, importRunId, summary) {
  await client.query(
    `
      UPDATE "drug_source_imports"
      SET
        "status" = $2,
        "raw_row_count" = $3,
        "imported_row_count" = $4,
        "rejected_row_count" = $5,
        "rejection_summary" = $6,
        "note" = $7,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = $1
    `,
    [
      importRunId,
      summary.status,
      summary.rawRowCount,
      summary.importedRowCount,
      summary.rejectedRowCount,
      summary.rejectionSummary,
      summary.note ?? null,
    ],
  );
}

async function queryTargetIdMap(client, sourceDataset, sourceTargetIds) {
  if (sourceTargetIds.length === 0) {
    return new Map();
  }

  const result = await client.query(
    `
      SELECT "id", "source_target_id"
      FROM "drugbank_targets"
      WHERE "source_dataset" = $1
        AND "source_target_id" = ANY($2::text[])
    `,
    [sourceDataset, sourceTargetIds],
  );

  return new Map(result.rows.map((row) => [row.source_target_id, row.id]));
}

async function executeTargetBatch(client, spec, importRunId, records) {
  if (records.length === 0) {
    return;
  }

  const normalizedTargets = records.map((record) => ({
    id: stableUuid(
      'drugbank_target',
      spec.sourceDataset,
      record.source_target_id,
    ),
    import_run_id: importRunId,
    source_dataset: spec.sourceDataset,
    source_target_id: record.source_target_id,
    name: record.name,
    gene_name: record.gene_name,
    genbank_protein_id: record.genbank_protein_id,
    genbank_gene_id: record.genbank_gene_id,
    uniprot_id: record.uniprot_id,
    uniprot_title: record.uniprot_title,
    pdb_ids: record.pdb_ids,
    gene_card_id: record.gene_card_id,
    gen_atlas_id: record.gen_atlas_id,
    hgnc_id: record.hgnc_id,
    species: record.species,
  }));

  await client.query('BEGIN');

  try {
    await executeUpsert(client, spec, normalizedTargets);

    const sourceTargetIds = normalizedTargets.map(
      (target) => target.source_target_id,
    );
    const targetIdMap = await queryTargetIdMap(
      client,
      spec.sourceDataset,
      sourceTargetIds,
    );

    const relationRecords = [];
    for (const record of records) {
      const targetId = targetIdMap.get(record.source_target_id);
      if (!targetId) {
        continue;
      }

      for (const drugbankId of record.drugbank_ids ?? []) {
        relationRecords.push({
          id: stableUuid(
            'drugbank_drug_target',
            spec.sourceDataset,
            record.source_target_id,
            drugbankId,
          ),
          drugbank_id: drugbankId,
          target_id: targetId,
          relation_kind: spec.sourceDataset,
          actions: record.actions ?? null,
          known_action: record.known_action ?? null,
        });
      }
    }

    await executeUpsert(
      client,
      {
        tableName: 'drugbank_drug_targets',
        columns: [
          'id',
          'drugbank_id',
          'target_id',
          'relation_kind',
          'actions',
          'known_action',
        ],
        conflictColumns: ['drugbank_id', 'target_id', 'relation_kind'],
        updateColumns: ['actions', 'known_action'],
      },
      relationRecords,
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function createParserArgs(config, sourcePath, options) {
  const parserArgs = [config.parser, '--source-path', sourcePath];

  if (options.limit !== undefined) {
    parserArgs.push('--limit', String(options.limit));
  }

  if (config.sourceDataset) {
    parserArgs.push('--source-dataset', config.sourceDataset);
  }

  return parserArgs;
}

async function runImport(command, cliOptions) {
  const config = COMMANDS[command];
  if (!config) {
    printUsage();
    throw new Error(`Unknown command: ${command}`);
  }

  const nodeEnv = loadEnvironment();
  const sourcePath = path.resolve(
    cliOptions.source ? String(cliOptions.source) : config.defaultSourcePath,
  );

  await fs.promises.access(sourcePath, fs.constants.R_OK);

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured for the current NODE_ENV');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const importRunId = await startImportRun(client, config, sourcePath, {
    sourceVersion:
      cliOptions['source-version'] !== undefined
        ? String(cliOptions['source-version'])
        : null,
    withHash: cliOptions['with-hash'] === true,
  });

  const summary = {
    status: 'completed',
    rawRowCount: 0,
    importedRowCount: 0,
    rejectedRowCount: 0,
    rejectionSummary: null,
    note: `Imported with NODE_ENV=${nodeEnv}`,
  };
  const rejectionSamples = [];
  const batchSize = parsePositiveIntegerOption(
    cliOptions['batch-size'] ?? 100,
    '--batch-size',
  );
  let currentBatch = [];

  try {
    const parserArgs = createParserArgs(config, sourcePath, {
      limit:
        cliOptions.limit !== undefined
          ? parsePositiveIntegerOption(cliOptions.limit, '--limit')
          : undefined,
    });

    const child = spawn('python', parserArgs, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const childExit = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', resolve);
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });

    const stdout = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    const flushBatch = async () => {
      if (currentBatch.length === 0) {
        return;
      }

      if (config.mode === 'targets') {
        await executeTargetBatch(client, config, importRunId, currentBatch);
      } else {
        const normalizedBatch = currentBatch.map((record) => ({
          ...record,
          import_run_id: importRunId,
        }));
        await executeUpsert(client, config, normalizedBatch);
      }

      summary.importedRowCount += currentBatch.length;
      currentBatch = [];
    };

    for await (const line of stdout) {
      if (!line.trim()) {
        continue;
      }

      const payload = JSON.parse(line);
      summary.rawRowCount += 1;

      if (payload.kind === 'error') {
        summary.rejectedRowCount += 1;
        collectRejectionSample(rejectionSamples, payload);
        continue;
      }

      if (payload.kind !== 'record') {
        summary.rejectedRowCount += 1;
        collectRejectionSample(rejectionSamples, {
          rowNumber: null,
          message: `Unsupported payload kind: ${String(payload.kind)}`,
        });
        continue;
      }

      currentBatch.push(payload.data);
      if (currentBatch.length >= batchSize) {
        await flushBatch();
      }
    }

    await flushBatch();

    const exitCode = await childExit;

    if (exitCode !== 0) {
      throw new Error(`Parser exited with code ${String(exitCode)}`);
    }

    summary.rejectionSummary =
      rejectionSamples.length > 0
        ? {
            sample: rejectionSamples,
          }
        : null;
  } catch (error) {
    summary.status = 'failed';
    summary.rejectionSummary = {
      sample: rejectionSamples,
    };
    summary.note =
      error instanceof Error ? error.message : 'Unknown import failure';
    throw error;
  } finally {
    await finishImportRun(client, importRunId, summary);
    await client.end();
  }

  console.log(
    JSON.stringify(
      {
        command,
        sourcePath,
        importRunId,
        rawRowCount: summary.rawRowCount,
        importedRowCount: summary.importedRowCount,
        rejectedRowCount: summary.rejectedRowCount,
        cacheInvalidation: await invalidateMedicineCache(),
      },
      null,
      2,
    ),
  );
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const command = argv._[0];

  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    await runImport(command, argv);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Import script failed',
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  invalidateMedicineCache,
  listMedicineCacheKeys,
  redisStoreFromUrl,
  stripNamespacePrefix,
};
